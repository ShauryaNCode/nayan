#include "LSHProjection.h"

#include <jni.h>

#include <stdexcept>

std::vector<std::vector<std::vector<float>>> LSHProjection::s_hyperplanes;

void LSHProjection::loadHyperplanes(
    const std::vector<std::vector<std::vector<float>>>& hyperplanes) {
  s_hyperplanes = hyperplanes;
}

std::string LSHProjection::computeBandKey(const float* embedding,
                                          int dims,
                                          int band) {
  if (s_hyperplanes.empty()) {
    throw std::runtime_error("LSHProjection: hyperplanes not loaded");
  }
  if (embedding == nullptr) {
    throw std::invalid_argument("LSHProjection: embedding must not be null");
  }
  if (band < 0 || band >= static_cast<int>(s_hyperplanes.size())) {
    throw std::out_of_range("LSHProjection: invalid band index");
  }

  const auto& planes = s_hyperplanes[band];
  uint8_t bits = 0;
  for (int p = 0; p < static_cast<int>(planes.size()); p++) {
    if (dims != static_cast<int>(planes[p].size())) {
      throw std::invalid_argument("LSHProjection: embedding dims mismatch");
    }

    float dot = 0.0f;
    for (int d = 0; d < dims; d++) {
      dot += embedding[d] * planes[p][d];
    }
    if (dot > 0.0f) {
      bits |= static_cast<uint8_t>(1u << p);
    }
  }
  return std::to_string(band) + "_" + std::to_string(bits);
}

std::vector<std::string> LSHProjection::computeBucketKeys(
    const float* embedding,
    int dims) {
  if (s_hyperplanes.empty()) {
    throw std::runtime_error("LSHProjection: hyperplanes not loaded");
  }

  std::vector<std::string> keys;
  keys.reserve(s_hyperplanes.size());
  for (int b = 0; b < static_cast<int>(s_hyperplanes.size()); b++) {
    keys.push_back(computeBandKey(embedding, dims, b));
  }
  return keys;
}

namespace {

void ThrowJavaException(JNIEnv* env,
                        const char* className,
                        const std::string& message) {
  if (env == nullptr || env->ExceptionCheck()) {
    return;
  }

  jclass exceptionClass = env->FindClass(className);
  if (exceptionClass == nullptr) {
    env->ExceptionClear();
    exceptionClass = env->FindClass("java/lang/RuntimeException");
    if (exceptionClass == nullptr) {
      env->ExceptionClear();
      return;
    }
  }

  env->ThrowNew(exceptionClass, message.c_str());
  env->DeleteLocalRef(exceptionClass);
}

std::vector<std::vector<std::vector<float>>> ReadHyperplanes(
    JNIEnv* env,
    jfloatArray values,
    jint bands,
    jint planesPerBand,
    jint dims) {
  if (values == nullptr) {
    throw std::invalid_argument("hyperplanes must not be null");
  }
  if (bands <= 0 || planesPerBand <= 0 || dims <= 0) {
    throw std::invalid_argument("hyperplane shape must be positive");
  }

  const jsize totalValues = env->GetArrayLength(values);
  const int expectedValues = bands * planesPerBand * dims;
  if (totalValues != expectedValues) {
    throw std::invalid_argument("hyperplane value count does not match shape");
  }

  jfloat* rawValues = env->GetFloatArrayElements(values, nullptr);
  if (rawValues == nullptr) {
    throw std::runtime_error("GetFloatArrayElements failed for hyperplanes");
  }

  std::vector<std::vector<std::vector<float>>> hyperplanes;
  hyperplanes.resize(static_cast<std::size_t>(bands));
  int offset = 0;

  try {
    for (int b = 0; b < bands; b++) {
      hyperplanes[static_cast<std::size_t>(b)].resize(
          static_cast<std::size_t>(planesPerBand));
      for (int p = 0; p < planesPerBand; p++) {
        auto& plane =
            hyperplanes[static_cast<std::size_t>(b)][static_cast<std::size_t>(p)];
        plane.resize(static_cast<std::size_t>(dims));
        for (int d = 0; d < dims; d++) {
          plane[static_cast<std::size_t>(d)] = rawValues[offset++];
        }
      }
    }
  } catch (...) {
    env->ReleaseFloatArrayElements(values, rawValues, JNI_ABORT);
    throw;
  }

  env->ReleaseFloatArrayElements(values, rawValues, JNI_ABORT);
  return hyperplanes;
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_com_offlinefaceauth_LSHModule_nativeLoadHyperplanes(
    JNIEnv* env,
    jclass,
    jfloatArray values,
    jint bands,
    jint planesPerBand,
    jint dims) {
  try {
    LSHProjection::loadHyperplanes(
        ReadHyperplanes(env, values, bands, planesPerBand, dims));
  } catch (const std::invalid_argument& exception) {
    ThrowJavaException(env, "java/lang/IllegalArgumentException",
                       exception.what());
  } catch (const std::exception& exception) {
    ThrowJavaException(env, "java/lang/RuntimeException", exception.what());
  } catch (...) {
    ThrowJavaException(env, "java/lang/RuntimeException",
                       "nativeLoadHyperplanes failed");
  }
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_com_offlinefaceauth_LSHModule_nativeComputeBucketKeys(
    JNIEnv* env,
    jclass,
    jfloatArray embeddingValues,
    jint dims) {
  try {
    if (embeddingValues == nullptr) {
      throw std::invalid_argument("embedding must not be null");
    }
    if (env->GetArrayLength(embeddingValues) != dims) {
      throw std::invalid_argument("embedding length does not match dims");
    }

    jfloat* embedding = env->GetFloatArrayElements(embeddingValues, nullptr);
    if (embedding == nullptr) {
      throw std::runtime_error("GetFloatArrayElements failed for embedding");
    }

    std::vector<std::string> keys;
    try {
      keys = LSHProjection::computeBucketKeys(embedding, dims);
    } catch (...) {
      env->ReleaseFloatArrayElements(embeddingValues, embedding, JNI_ABORT);
      throw;
    }
    env->ReleaseFloatArrayElements(embeddingValues, embedding, JNI_ABORT);

    jclass stringClass = env->FindClass("java/lang/String");
    jobjectArray result =
        env->NewObjectArray(static_cast<jsize>(keys.size()), stringClass, nullptr);
    env->DeleteLocalRef(stringClass);
    if (result == nullptr) {
      throw std::runtime_error("failed to allocate bucket key array");
    }

    for (jsize i = 0; i < static_cast<jsize>(keys.size()); i++) {
      jstring key = env->NewStringUTF(keys[static_cast<std::size_t>(i)].c_str());
      env->SetObjectArrayElement(result, i, key);
      env->DeleteLocalRef(key);
    }
    return result;
  } catch (const std::invalid_argument& exception) {
    ThrowJavaException(env, "java/lang/IllegalArgumentException",
                       exception.what());
  } catch (const std::exception& exception) {
    ThrowJavaException(env, "java/lang/RuntimeException", exception.what());
  } catch (...) {
    ThrowJavaException(env, "java/lang/RuntimeException",
                       "nativeComputeBucketKeys failed");
  }

  return nullptr;
}
