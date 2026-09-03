import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import {
  ProjectPickerView,
  type ProjectPickerRow,
} from "../src/v2/presentation/navigation/ProjectPickerView";

const project: ProjectPickerRow = {
  id: "/workspace/project",
  label: "project",
  path: "/workspace/project",
  pinned: false,
};

describe("V2 New Thread project selection", () => {
  it("adds and selects a validated server folder", async () => {
    const onAddProject = jest.fn(async (): Promise<ProjectPickerRow> => ({
      ...project,
      path: "/workspace/new-project",
      pinned: true,
    }));
    const onSelect = jest.fn(async () => undefined);
    render(
      <ProjectPickerView
        currentPath={null}
        isOpen
        onAddProject={onAddProject}
        onOpenChange={() => undefined}
        onPinProject={async () => undefined}
        onSelect={onSelect}
        projects={[project]}
      />,
    );

    fireEvent.press(screen.getByLabelText("Add project"));
    fireEvent.changeText(
      screen.getByLabelText("Project absolute path"),
      " /workspace/new-project ",
    );
    await act(async () => fireEvent.press(screen.getByLabelText("Use this project folder")));

    expect(onAddProject).toHaveBeenCalledWith("/workspace/new-project");
    expect(onSelect).toHaveBeenCalledWith("/workspace/new-project");
  });

  it("shows project pin progress until the action settles", async () => {
    const action = deferred<void>();
    render(
      <ProjectPickerView
        currentPath={null}
        isOpen
        onAddProject={async () => project}
        onOpenChange={() => undefined}
        onPinProject={() => action.promise}
        onSelect={async () => undefined}
        projects={[project]}
      />,
    );

    fireEvent.press(screen.getByLabelText("Pin project"));
    expect(screen.getByText("Pinning…")).toBeTruthy();
    await act(async () => {
      action.resolve(undefined);
      await action.promise;
    });
    expect(screen.queryByText("Pinning…")).toBeNull();
  });

  it("keeps the picker open, announces pin failures, and permits retry", async () => {
    let pinAttempts = 0;
    const onPinProject = jest.fn(async () => {
      pinAttempts += 1;
      if (pinAttempts === 1) throw new Error("Project path was rejected");
    });
    render(
      <ProjectPickerView
        currentPath={null}
        isOpen
        onAddProject={async () => project}
        onOpenChange={() => undefined}
        onPinProject={onPinProject}
        onSelect={async () => undefined}
        projects={[project]}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Pin project"));
    });

    await waitFor(() => expect(screen.getByText("Project path was rejected")).toBeTruthy());
    expect(screen.getByText("Project path was rejected").props.accessibilityLiveRegion).toBe(
      "polite",
    );
    expect(screen.queryByText("Pinning…")).toBeNull();

    await act(async () => fireEvent.press(screen.getByLabelText("Pin project")));
    expect(onPinProject).toHaveBeenCalledTimes(2);
  });

  it("keeps cached project selection available while live mutations are unavailable", async () => {
    const onSelect = jest.fn(async () => undefined);
    render(
      <ProjectPickerView
        currentPath={null}
        isOpen
        mutationsDisabled
        onAddProject={async () => project}
        onOpenChange={() => undefined}
        onPinProject={async () => undefined}
        onSelect={onSelect}
        projects={[project]}
      />,
    );

    expect(screen.getByLabelText("Add project").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Pin project").props.accessibilityState.disabled).toBe(true);

    await act(async () => fireEvent.press(screen.getByLabelText(`Project ${project.path}`)));
    expect(onSelect).toHaveBeenCalledWith(project.path);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
