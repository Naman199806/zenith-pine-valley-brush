# What survived the bundle

`apex-update-20.bundle` is an incremental git bundle. It lists two prerequisite commits that were not in the bundle:

- `25e4431` — S1 stopped before validation: not live-feasible on free data; negative dev and replication
- `1c0d932` — operational paper trading requested; orders tagged forward_test, not evidence; real money disabled

Unpacking recovered 8 objects and left 16 unresolved deltas. The files that came out intact are in this folder. The rest of the prior tree, including strategy implementations and numeric results, did not. Those results are not reconstructed.

Recovered commits:

- `6e7143e` — scheduled runs survive Windows stopping `wsl.exe`
- `7b0bbe4` — merge: S1 stopped, S2 holdout results
- `1a91869` — phone alerts; sprint 3 protocol still a draft

`alerts.py` is preserved and is not on the order path.
