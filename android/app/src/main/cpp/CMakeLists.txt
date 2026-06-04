cmake_minimum_required(VERSION 3.22)
project(nayan_android_native LANGUAGES C CXX)

if(DEFINED PROJECT_BUILD_DIR)
  set(NAYAN_ANDROID_PROJECT_BUILD_DIR ${PROJECT_BUILD_DIR})
endif()

if(DEFINED REACT_ANDROID_DIR)
  set(NAYAN_REACT_ANDROID_DIR ${REACT_ANDROID_DIR})
endif()

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../../../../cpp ${CMAKE_CURRENT_BINARY_DIR}/offline_face_auth_build)

add_library(offline_face_auth_jni SHARED
  ${CMAKE_CURRENT_LIST_DIR}/jni_bridge.cpp
  ${CMAKE_CURRENT_LIST_DIR}/lsh/LSHProjection.cpp
)

target_include_directories(offline_face_auth_jni
  PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}
    ${CMAKE_CURRENT_LIST_DIR}/lsh
    ${CMAKE_CURRENT_LIST_DIR}/../../../../../cpp
)

target_link_libraries(offline_face_auth_jni
  PRIVATE
    nayan::native_engine
    ReactAndroid::jsi
    fbjni::fbjni
    android
    log
    jnigraphics
)
