import { NodeyCode, NodeyCodeCell, SyntaxToken } from "../nodey";

import * as CodeMirror from "codemirror";

import { CodeMirrorEditor } from "@jupyterlab/codemirror";

import { HistoryModel } from "../history-model";

import { ASTUtils } from "./ast-utils";

import * as crypto from "crypto";
import * as levenshtein from "fast-levenshtein";

export class ASTResolve {
  historyModel: HistoryModel;

  constructor(historyModel: HistoryModel) {
    this.historyModel = historyModel;
  }

  repairAST(
    nodey: NodeyCodeCell,
    change: CodeMirror.EditorChange,
    editor: CodeMirrorEditor
  ) {
    var range = {
      start: change.from,
      end: change.to
    }; // first convert code mirror coordinates to our coordinates

    var affected = ASTUtils.findNodeAtRange(nodey, range, this.historyModel);

    if (affected) {
      // shift all nodey positions after affected
      var newEnd = this.repairPositions(affected, change);
      // return the text from this node's new range
      var text = editor.doc.getRange(affected.start, newEnd);
      console.log(
        "The exact affected nodey is",
        affected,
        text,
        range.start,
        newEnd
      );
    } // if there's no specific node broken, the whole cell node is broken
    else {
      affected = nodey;
      // return the text from this node's new range
      var text = editor.doc.getValue();
      console.log("The exact affected nodey is", affected, text, range);
    }

    var updateID = crypto.randomBytes(20).toString("hex");
    affected.pendingUpdate = updateID;

    var kernel_reply = this.recieve_newVersion.bind(this, affected, updateID);
    return [kernel_reply, text];
  }

  repairPositions(
    affected: NodeyCode,
    change: CodeMirror.EditorChange
  ): { line: number; ch: number } {
    // shift all nodes after this changed node
    var [nodeEnd, deltaLine, deltaCh] = this.calcShift(affected, change);
    if (affected.right) {
      var right = this.historyModel.getNodeyHead(affected.right) as NodeyCode;
      if (right.start.line !== nodeEnd.line) deltaCh = 0;
      this.shiftAllAfter(right, deltaLine, deltaCh);
    }
    return nodeEnd;
  }

  calcShift(
    affected: NodeyCode,
    change: CodeMirror.EditorChange
  ): [{ line: number; ch: number }, number, number] {
    var nodeEnd = affected.end;

    // calculate deltas
    var deltaLine = 0;
    var deltaCh = 0;

    var added_line = change.text.length;
    var removed_line = change.removed.length;
    deltaLine = added_line - removed_line;

    var added_ch = (change.text[Math.max(change.text.length - 1, 0)] || "")
      .length;
    var removed_ch = (
      change.removed[Math.max(change.removed.length - 1, 0)] || ""
    ).length;
    deltaCh = added_ch - removed_ch;

    // need to calculate: change 'to' line is not dependable because it is before coordinates only
    var endLine = change.from.line + deltaLine;

    // update this node's coordinates
    if (endLine === nodeEnd.line) nodeEnd.ch = nodeEnd.ch + deltaCh;
    else nodeEnd.line = nodeEnd.line + deltaLine;

    return [nodeEnd, deltaLine, deltaCh];
  }

  shiftAllAfter(nodey: NodeyCode, deltaLine: number, deltaCh: number): void {
    if (deltaLine === 0 && deltaCh === 0)
      //no more shifting, stop
      return;

    console.log(
      "Shifting ",
      nodey,
      "by",
      deltaLine,
      " ",
      deltaCh,
      " before:" + nodey.start.line + " " + nodey.start.ch
    );
    nodey.start.line += deltaLine;
    nodey.end.line += deltaLine;
    nodey.start.ch += deltaCh;

    //Now be sure to shift all children
    this.shiftAllChildren(nodey, deltaLine, deltaCh);

    if (nodey.right) {
      var rightSibling = this.historyModel.getNodeyHead(
        nodey.right
      ) as NodeyCode;
      if (rightSibling.start.line !== nodey.start.line) deltaCh = 0;
      this.shiftAllAfter(rightSibling, deltaLine, deltaCh);
    }
  }

  shiftAllChildren(nodey: NodeyCode, deltaLine: number, deltaCh: number): void {
    var children = nodey.getChildren();
    for (var i in children) {
      var child = this.historyModel.getNodeyHead(children[i]) as NodeyCode;
      child.start.line += deltaLine;
      child.end.line += deltaLine;
      child.start.ch += deltaCh;
      this.shiftAllChildren(child, deltaLine, deltaCh);
    }
  }

  recieve_newVersion(
    nodey: NodeyCode,
    updateID: string,
    jsn: string
  ): NodeyCode {
    if (nodey.pendingUpdate && nodey.pendingUpdate === updateID) {
      console.log("Time to resolve", jsn, "with", nodey);
      var dict = ASTUtils.reduceASTDict(JSON.parse(jsn));
      console.log("Reduced AST", dict);

      var [score, transforms] = this.matchNode(dict, nodey);
      console.log("Match?", score, transforms);
      this.historyModel.stageChanges(transforms, nodey);

      //resolved
      if (nodey.pendingUpdate === updateID) nodey.pendingUpdate = null;
    }
    return nodey;
  }

  match(
    nodeIndex: number,
    nodeList: { [key: string]: any }[],
    oldNodeyList: string[],
    candidateList: any[]
  ): [number, any[], any[]] {
    var nodeToMatch = nodeList[nodeIndex];
    var options = [];
    var updates = [];
    var totalScore = 0;
    console.log("Attempting to match", nodeToMatch);

    for (var i = 0; i < candidateList.length; i++) {
      if (nodeToMatch[SyntaxToken.KEY]) {
        if (candidateList[i] instanceof SyntaxToken)
          var [score, updates] = this.matchSyntaxToken(
            nodeToMatch,
            candidateList[i],
            nodeIndex
          );
        else continue;
      } else if (candidateList[i] instanceof SyntaxToken) continue;
      //syntok can only match syntok
      else {
        var candidate = this.historyModel.getNodeyHead(
          candidateList[i]
        ) as NodeyCode;
        var [score, updates] = this.matchNode(nodeToMatch, candidate);
      }

      if (score === 0) {
        // perfect match
        candidateList.splice(i, 1); // remove from candidate list
        if (nodeIndex < nodeList.length - 1)
          return this.match(
            nodeIndex + 1,
            nodeList,
            oldNodeyList,
            candidateList
          );
        else return [0, candidateList, []];
      }

      if (score != -1) options[i] = { score: score, transforms: updates };
    }

    // if we've gotten here, an exact match was NOT found
    if (nodeIndex < nodeList.length - 1)
      var [totalScore, candidateList, updates] = this.match(
        nodeIndex + 1,
        nodeList,
        oldNodeyList,
        candidateList
      );

    console.log(nodeToMatch, " now options are ", options, candidateList);
    var bestMatch;
    var matchIndex;
    for (var j = 0; j < candidateList.length; j++) {
      if (options[j]) {
        //can use this one
        if (!bestMatch || bestMatch.score > options[j].score) {
          bestMatch = options[j];
          matchIndex = j;
        }
      }
    }

    if (bestMatch) {
      totalScore = bestMatch.score;
      candidateList.splice(matchIndex, 1);
      updates.concat(bestMatch.transforms);
    } else updates.push(this.addNewNode.bind(this, nodeToMatch, nodeIndex));

    return [totalScore, candidateList, updates];
  }

  matchNode(
    node: { [key: string]: any },
    potentialMatch: NodeyCode
  ): [number, any[]] {
    if (node.type !== potentialMatch.type) return [-1, []];
    if (node.literal && potentialMatch.literal)
      //leaf nodes
      return [
        this.matchLiterals(node.literal + "", potentialMatch.literal + ""),
        [this.changeLiteral.bind(this, node)]
      ];
    else {
      var [totalScore, candidateList, updates] = this.match(
        0,
        node.content,
        potentialMatch.content,
        potentialMatch.content.slice(0)
      );
      candidateList.map(x => {
        console.log("to remove", x);
        if (x instanceof SyntaxToken)
          updates.push(this.removeSyntaxToken.bind(this, x));
        else
          updates.push(
            this.removeOldNode.bind(this, this.historyModel.getNodeyHead(x))
          );
      });
      return [totalScore, updates];
    }
  }

  changeLiteral(node: { [key: string]: any }, target: NodeyCode) {
    console.log(
      "Changing literal from " + target.literal + " to " + node.literal
    );
    target.literal = node.literal;
  }

  changeSyntaxToken(
    node: { [key: string]: any },
    at: number,
    target: NodeyCode
  ) {
    target.content[at] = node[SyntaxToken.KEY];
  }

  addNewNode(node: { [key: string]: any }, at: number, target: NodeyCode) {
    var nodey = this.buildStarNode(node, target);
    nodey.parent = target.name;
    console.log("Added a new node " + nodey + " to ", target);
    target.content.splice(at, 0, nodey.name);
  }

  buildStarNode(
    node: { [key: string]: any },
    target: NodeyCode,
    prior: NodeyCode = null
  ): NodeyCode {
    node.id = "*";
    var n = new NodeyCode(node);
    n.start.line -= 1; // convert the coordinates of the range to code mirror style
    n.end.line -= 1;
    n.positionRelativeTo(target);
    var label = this.historyModel.addStarNode(n, target);
    n.version = label;

    if (prior) prior.right = n.name;
    prior = null;

    n.content = [];
    for (var item in node.content) {
      var child = this.buildStarNode(node.content[item], target, prior);
      child.parent = n.name;
      if (prior) prior.right = child.name;
      n.content.push(child.name);
      prior = child;
    }

    return n;
  }

  removeOldNode(node: NodeyCode, target: NodeyCode) {
    var index = target.content.indexOf(node.name);
    console.log("Removing old node", node, "from", target);
    target.content.splice(index, 1);
  }

  removeSyntaxToken(tok: SyntaxToken, target: NodeyCode) {
    var index = target.content.indexOf(tok);
    console.log("Removing old token", tok, "from", target);
    target.content.splice(index, 1);
  }

  matchLiterals(val1: string, val2: string): number {
    return levenshtein.get(val1, val2);
  }

  matchSyntaxToken(
    node: { [key: string]: any },
    potentialMatch: SyntaxToken,
    position: number
  ): [number, any[]] {
    return [
      this.matchLiterals(node[SyntaxToken.KEY], potentialMatch.tokens),
      [this.changeSyntaxToken.bind(this, node, position)]
    ];
  }
}
