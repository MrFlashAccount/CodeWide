#include <jni.h>
#include <malloc.h>

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_codewide_app_performance_CodexPerformanceModule_nativePurgeAllocator(
    JNIEnv*,
    jobject,
    jboolean exhaustive) {
  const int option = exhaustive == JNI_TRUE ? M_PURGE_ALL : M_PURGE;
  return mallopt(option, 0) == 1 ? JNI_TRUE : JNI_FALSE;
}
