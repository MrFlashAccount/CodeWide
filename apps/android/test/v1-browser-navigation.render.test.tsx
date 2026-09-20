import { act, renderHook } from "@testing-library/react-native";
import { useBrowserNavigationState } from "../src/features/browser/browserNavigationState";

it("retains native navigation identity through redirects and resets only an explicit caller destination", () => {
  const hook = renderHook(({url}) => useBrowserNavigationState(url), {initialProps:{url:"https://example.com/start"}});
  const webView = hook.result.current.webView;
  const navigate = hook.result.current.navigateAddress;
  act(() => navigate("https://example.com/search"));
  expect(hook.result.current.addressSource.uri).toBe("https://example.com/search");
  expect(hook.result.current.navigation.loading).toBe(true);
  act(() => hook.result.current.updateNavigation({url:"https://example.com/result",title:"Result",loading:false,canGoBack:true,canGoForward:false,target:1,lockIdentifier:0}));
  hook.rerender({url:"https://example.com/start"});
  expect(hook.result.current.navigation).toMatchObject({url:"https://example.com/result",canGoBack:true,loading:false});
  expect(hook.result.current.addressSource.uri).toBe("https://example.com/result");
  expect(hook.result.current.webView).toBe(webView);
  expect(hook.result.current.navigateAddress).toBe(navigate);
  hook.rerender({url:"https://another.example/"});
  expect(hook.result.current.navigation).toMatchObject({url:"https://another.example/",canGoBack:false,canGoForward:false,loading:false});
  expect(hook.result.current.addressSource.uri).toBe("https://another.example/");
  expect(hook.result.current.webView).toBe(webView);
});
