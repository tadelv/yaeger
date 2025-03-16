# A guide how to for the gen

## Prerequisites

Have PMD installed

## How to

In the same dir as the .py, .toml and .lock

```bash
pdm install
```

You now have the choice to either active the .venv

### Activate venv

```bash
pdm venv activate
```

Then

```bash
python3 fig-gen.py ex_roast.json
```

### Directly through PDM

```bash
pdm run python3 fig-gen.py ex_roast.json
```
