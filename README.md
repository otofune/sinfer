# sinfer

Infer types from structures like JSON and convert into Go source code

## Getting Started

0. Correct JSON files

```sh
cat > a.json <<EOF
{"int": 3, "fl": 1, "optional": "yey"}
EOF
cat > b.json <<EOF
{"int": 0, "fl": 3.2}
EOF
```

1. Write configuration file (for detail, see configSchema in [index.ts](./src/index.ts))

```sh
cat > config.json <<EOF
{
    "glob": "./{a,b}.json"
}
EOF
```

2. Run sinfer

```sh
% yarn
% yarn gen ./config.json
yarn run v1.22.10
$ ts-node . ./config.json
struct {
        Integer *(int)  `json:"integer"`
        Float   *(float64)      `json:"float"`
        Optional        string  `json:"optional"`
}
✨  Done in 2.07s.
```
