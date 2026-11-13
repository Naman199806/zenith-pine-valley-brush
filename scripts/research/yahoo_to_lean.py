"""Yahoo daily to LEAN equity daily.

Prices are the vendor's split-adjusted, dividend-unadjusted prints.
LEAN wants deci-cents. Factor file is identity because the source is already split-adjusted.
This is a research adapter, not a corporate-action reconstruction.
"""
import json
import zipfile
from pathlib import Path

SRC = Path("/workspace/research/data/raw/yahoo/20261112/SPY.json")
OUT = Path("/workspace/.runtimes/lean-run/Data/equity/usa")


def main():
    raw = json.loads(SRC.read_text())
    bars = raw["bars"]
    lines = []
    for bar in bars:
        date = bar["date"].replace("-", "")
        # LEAN equity daily: YYYYMMDD HH:MM, open, high, low, close, volume in deci-cents.
        scale = lambda price: str(int(round(price * 10000)))
        lines.append(
            f"{date} 00:00,{scale(bar['open'])},{scale(bar['high'])},{scale(bar['low'])},{scale(bar['close'])},{int(bar['volume'])}"
        )
    daily = OUT / "daily"
    daily.mkdir(parents=True, exist_ok=True)
    zip_path = daily / "spy.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("spy.csv", "\n".join(lines) + "\n")
    maps = OUT / "map_files"
    factors = OUT / "factor_files"
    maps.mkdir(parents=True, exist_ok=True)
    factors.mkdir(parents=True, exist_ok=True)
    first = bars[0]["date"].replace("-", "")
    (maps / "spy.csv").write_text(f"{first},spy,P\n20501231,spy,P\n")
    # Identity factors. Source is already split-adjusted. Dividends are not reconstructed.
    (factors / "spy.csv").write_text(f"{first},1,1,{bars[0]['close']:.4f}\n20501231,1,1,{bars[-1]['close']:.4f}\n")
    print(json.dumps({"ok": True, "bars": len(bars), "first": bars[0]["date"], "last": bars[-1]["date"], "zip": str(zip_path)}))


if __name__ == "__main__":
    import json
    main()
