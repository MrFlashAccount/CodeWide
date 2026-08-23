#include <jni.h>

#include <exception>
#include <string>

#include <jsi/instrumentation.h>
#include <jsi/jsi.h>

namespace {

class JStringChars final {
 public:
  JStringChars(JNIEnv* env, jstring value) : env_(env), value_(value) {
    chars_ = env_->GetStringUTFChars(value_, nullptr);
  }

  ~JStringChars() {
    if (chars_ != nullptr) env_->ReleaseStringUTFChars(value_, chars_);
  }

  const char* get() const {
    return chars_;
  }

 private:
  JNIEnv* env_;
  jstring value_;
  const char* chars_{nullptr};
};

void throwJavaException(JNIEnv* env, const char* message) {
  jclass exceptionClass = env->FindClass("java/lang/IllegalStateException");
  if (exceptionClass != nullptr) env->ThrowNew(exceptionClass, message);
}

} // namespace

extern "C" JNIEXPORT void JNICALL
Java_dev_codewide_app_performance_CodexPerformanceModule_nativeCaptureHermesHeapSnapshot(
    JNIEnv* env,
    jobject,
    jlong runtimePointer,
    jstring destinationPath,
    jboolean collectGarbageFirst) {
  if (runtimePointer == 0 || destinationPath == nullptr) {
    throwJavaException(env, "Hermes runtime is unavailable");
    return;
  }

  JStringChars path(env, destinationPath);
  if (path.get() == nullptr) return;

  auto* runtime = reinterpret_cast<facebook::jsi::Runtime*>(runtimePointer);
  try {
    auto& instrumentation = runtime->instrumentation();
    if (collectGarbageFirst == JNI_TRUE) {
      instrumentation.collectGarbage("CodeWide retained heap snapshot");
    }
    instrumentation.createSnapshotToFile(path.get(), {true});
  } catch (const std::exception& error) {
    throwJavaException(env, error.what());
  } catch (...) {
    throwJavaException(env, "Hermes heap snapshot failed");
  }
}
