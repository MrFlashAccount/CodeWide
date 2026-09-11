import { fireEvent, render } from "@testing-library/react-native";
import { BrowserAddressBar } from "../src/browser/BrowserAddressBar";

it("keeps typed text during redirects and resolves it against the latest page on Go", () => {
  const navigate = jest.fn();
  const view = render(<BrowserAddressBar url="http://127.0.0.1:43210/start" onNavigate={navigate} />);
  fireEvent(view.getByLabelText("Browser address"), "focus");
  fireEvent.changeText(view.getByLabelText("Browser address"), "/settings");
  view.rerender(<BrowserAddressBar url="http://127.0.0.1:43210/redirect" onNavigate={navigate} />);
  expect(view.getByDisplayValue("/settings")).toBeTruthy();
  fireEvent.press(view.getByLabelText("Go to address"));
  expect(navigate).toHaveBeenCalledWith("http://127.0.0.1:43210/settings");
});

it("tracks back/forward URLs outside editing and cancels a draft", () => {
  const navigate = jest.fn();
  const view = render(<BrowserAddressBar url="https://example.com/first" onNavigate={navigate} />);
  view.rerender(<BrowserAddressBar url="https://example.com/second" onNavigate={navigate} />);
  expect(view.getByDisplayValue("https://example.com/second")).toBeTruthy();
  fireEvent.changeText(view.getByLabelText("Browser address"), "wrong address");
  fireEvent.press(view.getByLabelText("Cancel address editing"));
  expect(view.getByDisplayValue("https://example.com/second")).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});

it("keeps invalid text for correction and submits valid text with the keyboard", () => {
  const navigate = jest.fn();
  const view = render(<BrowserAddressBar url="https://example.com" onNavigate={navigate} />);
  fireEvent.changeText(view.getByLabelText("Browser address"), "javascript:alert(1)");
  fireEvent(view.getByLabelText("Browser address"), "submitEditing");
  expect(view.getByRole("alert")).toHaveTextContent(/valid HTTP or HTTPS/u);
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText("Browser address"), "example.org/page");
  fireEvent(view.getByLabelText("Browser address"), "submitEditing");
  expect(navigate).toHaveBeenCalledWith("https://example.org/page");
});

it("reports editing while the address field owns the browser toolbar", () => {
  const editing = jest.fn();
  const view = render(
    <BrowserAddressBar
      url="https://example.com"
      onEditingChange={editing}
      onNavigate={jest.fn()}
    />,
  );

  fireEvent(view.getByLabelText("Browser address"), "focus");
  expect(editing).toHaveBeenLastCalledWith(true);
  fireEvent.press(view.getByLabelText("Cancel address editing"));
  expect(editing).toHaveBeenLastCalledWith(false);
});
