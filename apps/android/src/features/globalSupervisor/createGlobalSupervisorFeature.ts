import { createGlobalSupervisorActivationOwner } from "./globalSupervisorActivationOwner";
import type {
  GlobalSupervisorFeature,
  GlobalSupervisorRecovery,
  GlobalSupervisorRuntime,
} from "./globalSupervisorContract";
import { createGlobalSupervisorOperationOwner } from "./globalSupervisorOperationOwner";
import { createGlobalSupervisorRenderModel } from "./globalSupervisorRenderModel";

/** Composes preparation, activation, render projection and public action settlement. */
export function createGlobalSupervisorFeature(
  runtime: GlobalSupervisorRuntime,
): GlobalSupervisorFeature {
  const render = createGlobalSupervisorRenderModel();
  const activation = createGlobalSupervisorActivationOwner(runtime, render);
  const operations = createGlobalSupervisorOperationOwner();

  const prepareAndStart = async (): Promise<void> => {
    try {
      const preparation = await runtime.prepare((progress) => {
        if (!activation.hasActivation()) {
          render.publishPreparationProgress(progress);
        }
      });
      if (!activation.hasActivation()) {
        render.publishPreparation(preparation);
        if (preparation.status === "ready") {
          await activation.start(preparation.home);
        }
      }
    } catch {
      render.fail("preparationFailed", {
        action: "retryCapabilityProbe",
        label: "Retry voice check",
      });
    }
  };

  const enter = async (): Promise<void> => {
    if (activation.hasActivation()) {
      return;
    }
    const current = operations.current();
    return current === null ? operations.run("enter", prepareAndStart) : current.promise;
  };

  const start = async (): Promise<void> => {
    const currentOperation = operations.current();
    if (currentOperation !== null || activation.hasActivation()) {
      return currentOperation?.promise ?? Promise.resolve();
    }
    const current = render.render$.peek();
    if (current.phase !== "ready") {
      return;
    }
    return operations.run("start", async () => activation.start(current.home));
  };

  const stop = async (): Promise<void> => {
    const current = operations.current();
    if (current?.kind === "stop") {
      return current.promise;
    }
    const preceding = current?.promise ?? Promise.resolve();
    return operations.run("stop", async () => {
      await preceding;
      await activation.stop();
    });
  };

  const recoverWith = async (recovery: GlobalSupervisorRecovery): Promise<void> =>
    operations.run("recover", async () => {
      try {
        if (activation.hasActivation()) {
          await activation.stop();
        }
        await runtime.recover(recovery);
        await prepareAndStart();
      } catch (error) {
        render.fail("preparationFailed", {
          action: "retryCapabilityProbe",
          label: "Retry voice check",
        });
        throw error;
      }
    });

  const recover = async (): Promise<void> => {
    const current = operations.current();
    if (current !== null) {
      return current.promise;
    }
    const recovery = render.render$.peek().recovery;
    if (recovery === null) {
      return;
    }
    return recoverWith(recovery);
  };

  const toggle = async (): Promise<void> => {
    const currentOperation = operations.current();
    if (currentOperation !== null) {
      return currentOperation.kind === "stop" ? currentOperation.promise : stop();
    }
    if (activation.hasActivation()) {
      return stop();
    }
    const snapshot = render.render$.peek();
    const phase = snapshot.phase;
    if (phase === "ready") {
      return start();
    }
    if (phase === "failed" || phase === "unbound") {
      const recovery = snapshot.recovery;
      render.publishActivating();
      return recoverWith(recovery);
    }
    return enter();
  };

  const toggleMicrophone = async (): Promise<void> => {
    await activation.setMicrophoneMuted(!activation.microphoneMuted$.peek());
  };

  return {
    enter,
    microphoneMuted$: activation.microphoneMuted$,
    pause: activation.pause,
    recover,
    render$: render.render$,
    resume: activation.resume,
    start,
    stop,
    toggle,
    toggleMicrophone,
  };
}
