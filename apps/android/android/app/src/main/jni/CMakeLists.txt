cmake_minimum_required(VERSION 3.13)
project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

add_library(codewide_performance SHARED
  performance/HermesHeapSnapshot.cpp
)

target_link_libraries(codewide_performance
  jsi
  log
)
