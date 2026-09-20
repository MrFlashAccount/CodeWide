import {describe,expect,it} from "vitest";
import {parseDevToolsMessage} from "../src/features/browser/devToolsMessage";

describe("browser DevTools bridge messages",()=>{
  it("admits dock, health and transport events from the existing bridge protocol",()=>{
    expect(parseDevToolsMessage(JSON.stringify({source:"codewide-devtools-dock",side:"left"}))).toEqual({source:"codewide-devtools-dock",side:"left"});
    expect(parseDevToolsMessage(JSON.stringify({source:"codewide-devtools-health",state:"error",message:"Empty document"}))).toEqual({source:"codewide-devtools-health",state:"error",message:"Empty document"});
    expect(parseDevToolsMessage(JSON.stringify({source:"codewide-devtools-transport",event:"close",code:1001,reason:"Closed"}))).toEqual({source:"codewide-devtools-transport",event:"close",code:1001,reason:"Closed"});
  });
  it("rejects unrelated or malformed messages without changing the session",()=>{
    for(const payload of [null,[],{source:"other"},{source:"codewide-devtools-dock",side:"top"},{source:"codewide-devtools-health",state:"loading"},{source:"codewide-devtools-transport",event:"message"}]) expect(parseDevToolsMessage(JSON.stringify(payload))).toBeNull();
    expect(parseDevToolsMessage("not json")).toBeNull();
  });
});
