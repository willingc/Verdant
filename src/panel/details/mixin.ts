import { Widget } from "@phosphor/widgets";

import {
  Nodey,
  NodeyCodeCell,
  NodeyCode,
  NodeyMarkdown,
  NodeyOutput
} from "../../model/nodey";

import { History } from "../../model/history";

import { VersionSampler } from "./version-sampler";

const HEADER = "v-VerdantPanel-crumbMenu";
const CRUMB_MENU_CONTENT = "v-VerdantPanel-inspect-content";
const HEADER_TARGET = "v-VerdantPanel-crumbMenu-item";
//const HEADER_WISK = "v-VerdantPanel-mixin-mixButton";
const CRUMB_MENU_SEPERATOR = "v-VerdantPanel-crumbMenu-seperator";

export class Mixin extends Widget {
  readonly historyModel: History;
  readonly targetList: Nodey[];
  private notebookLink: (ver: number) => void;
  private _headerShowing: boolean;
  private header: HTMLElement;
  private content: HTMLElement;

  constructor(
    historyModel: History,
    target: Nodey[],
    header: boolean = true,
    notebookLink: (ver: number) => void
  ) {
    super();
    this.historyModel = historyModel;
    this.targetList = target || [];
    this.notebookLink = notebookLink;
    this._headerShowing = header;

    this.header = document.createElement("div");
    this.header.classList.add(HEADER);
    this.buildHeader();

    this.content = document.createElement("ul");
    this.content.classList.add(CRUMB_MENU_CONTENT);
    this.node.appendChild(this.content);
    this.buildDetails();
  }

  buildHeader() {
    if (this._headerShowing) {
      let menu = this.header;
      if (this.targetList.length < 2) {
        let target = this.targetList[0];
        if (target instanceof NodeyCode)
          Mixin.labelNodeyCode(menu, target, this.historyModel);
        else if (target instanceof NodeyMarkdown)
          Mixin.addItem(menu, "markdown " + target.id);
        else if (target instanceof NodeyOutput)
          Mixin.addItem(menu, "output " + target.id);

        /*let wiskButton = document.createElement("div");
        wiskButton.classList.add(HEADER_WISK);
        menu.appendChild(wiskButton);*/
      } else {
        //TODO
      }

      this.node.appendChild(this.header);
    }
  }

  buildDetails() {
    let target = this.targetList[0];
    let verList = this.historyModel.inspector.versionsOfTarget([target]);

    let contentDiv = this.content;
    contentDiv.innerHTML = "";

    verList.map(async item => {
      let nodeyVer = this.historyModel.store.get(item.version);
      let header = VersionSampler.verHeader(
        this.historyModel,
        nodeyVer,
        this.notebookLink
      );
      let sample = VersionSampler.sample(this.historyModel, nodeyVer);

      let itemDiv = document.createElement("div");
      itemDiv.appendChild(header);
      itemDiv.appendChild(sample);
      contentDiv.insertBefore(itemDiv, contentDiv.firstElementChild);
    });
  }
}

export namespace Mixin {
  export function labelNodeyCode(
    menu: HTMLElement,
    target: NodeyCode,
    historyModel: History
  ): void {
    if (target instanceof NodeyCodeCell) {
      Mixin.addItem(menu, "cell " + target.id);
    } else {
      let cell = historyModel.store.getCellParent(target);
      let cellItem = Mixin.addItem(menu, "cell " + cell.id);
      cellItem.addEventListener("click", () =>
        historyModel.inspector.changeTarget([cell])
      );

      Mixin.addSeperator(menu);

      Mixin.addItem(menu, target.type + " " + target.id);
    }
  }

  export function addSeperator(menu: HTMLElement) {
    let seperator = document.createElement("div");
    seperator.classList.add(CRUMB_MENU_SEPERATOR);
    seperator.textContent = ">";
    menu.appendChild(seperator);
  }

  export function addItem(menu: HTMLElement, label: string) {
    let item = document.createElement("div");
    item.classList.add(HEADER_TARGET);
    item.textContent = label;
    menu.appendChild(item);
    return item;
  }
}
