import {act,renderHook} from "@testing-library/react-native";
import {useBackgroundTerminalActions} from "../src/features/terminal/backgroundTerminalActions";
import type {BackgroundTerminalValue} from "../src/data/workspace-resource-database";

it("keeps termination pending through its captured refresh and reports refresh failure",async()=>{
  let rejectRefresh:(cause:Error)=>void=()=>{throw new Error("Refresh not started");};
  const refresh=jest.fn(()=>new Promise<BackgroundTerminalValue[]>((_resolve,reject)=>{rejectRefresh=reject;}));
  const terminate=jest.fn(async()=>true);
  const hook=renderHook(({onList})=>useBackgroundTerminalActions(onList,terminate),{initialProps:{onList:refresh}});
  let operation=Promise.resolve();
  await act(async()=>{operation=hook.result.current.terminate("process");});
  expect(terminate).toHaveBeenCalledWith("process");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(hook.result.current.busyId).toBe("process");
  const replacement=jest.fn(async()=>[]);
  hook.rerender({onList:replacement});
  await act(async()=>{rejectRefresh(new Error("Refresh unavailable"));await operation;});
  expect(hook.result.current.error).toBe("Refresh unavailable");
  expect(hook.result.current.busyId).toBeNull();
  expect(replacement).not.toHaveBeenCalled();
});
