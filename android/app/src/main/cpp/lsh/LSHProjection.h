#pragma once

#include <cstdint>
#include <string>
#include <vector>

class LSHProjection {
 public:
  // hyperplanes: [bands][planes_per_band][dims]
  // Loaded once at module init from the JS constants.
  static void loadHyperplanes(
      const std::vector<std::vector<std::vector<float>>>& hyperplanes);

  // Project a 128-D L2-normalised float32 embedding through all bands.
  // Returns one bucket key string per band.
  // Format: "{band_index}_{6_bit_integer}"
  // Example: "0_42", "1_17", "2_63", "3_5"
  static std::vector<std::string> computeBucketKeys(const float* embedding,
                                                    int dims);

 private:
  static std::vector<std::vector<std::vector<float>>> s_hyperplanes;

  static std::string computeBandKey(const float* embedding, int dims, int band);
};
