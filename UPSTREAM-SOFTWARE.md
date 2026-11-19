# CenRE software snapshot

This snapshot is based on the selected source files from
[billsargent/centurion at 2bf3550](https://github.com/billsargent/centurion/tree/2bf355026e3f5d4ebdf51138088b9499ccb31b09),
a modified version of Meisaka Yukara's CenRE. The license and attribution
files are included. The TypeScript references external firmware tables
through the host instead of initializing them from embedded payloads.
The table lengths are recorded in `src/firmware-spec.json`.
