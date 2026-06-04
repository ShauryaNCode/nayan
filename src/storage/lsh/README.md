# LSH Vector Index

T3.4 uses immutable random hyperplanes stored in
`src/crypto/LSHHyperplanes.ts`. Do not regenerate those constants after the
first enrollment; changing them invalidates every row in `lsh_index` and
requires re-enrollment.

Runtime entry points:

- `src/storage/LSHIndex.ts` owns enrollment indexing and verification queries.
- `src/crypto/LSHModule.ts` bridges to the native Android projection module.
- `android/app/src/main/cpp/lsh/LSHProjection.cpp` computes bucket keys in C++.

The legacy files in this folder are compatibility exports only. Hyperplanes are
not stored in MMKV, SQLCipher, or any runtime-configurable setting.
