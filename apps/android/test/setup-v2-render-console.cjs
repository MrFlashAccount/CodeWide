let consoleError;

beforeEach(() => {
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  const calls = consoleError.mock.calls;
  consoleError.mockRestore();
  if (calls.length === 0) return;
  const details = calls
    .map((call) =>
      call.map((value) => (value instanceof Error ? value.stack : String(value))).join(" "),
    )
    .join("\n");
  throw new Error(`Unexpected console.error in V2 render test:\n${details}`);
});
