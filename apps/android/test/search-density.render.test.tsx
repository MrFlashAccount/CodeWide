import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";

it("gives the narrow split view more catalog room without consuming the conversation", () => {
  for (const width of [840, 900, 1024, 1440]) {
    const sidebar = desktopThreadSidebarWidth(width);
    expect(sidebar).toBeGreaterThanOrEqual(320);
    expect(sidebar).toBeLessThanOrEqual(480);
    expect(width - sidebar).toBeGreaterThanOrEqual(520);
  }
});
