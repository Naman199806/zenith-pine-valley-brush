/*
 * Frozen 12-1 SPY momentum inside the pinned LEAN engine.
 * Rules match the audited baseline. Holdout starts 2025-11-11 and is not traded.
 * Sizing is explicit: 95 percent of portfolio value. Not the one-share baseline.
 */
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using QuantConnect;
using QuantConnect.Algorithm;
using QuantConnect.Data;
using QuantConnect.Orders;

namespace Apex.Research
{
    public class ApexMomentumAlgorithm : QCAlgorithm
    {
        private Symbol _spy;
        private readonly List<Dictionary<string, object>> _fills = new List<Dictionary<string, object>>();
        private static readonly DateTime Holdout = new DateTime(2025, 11, 11);

        public override void Initialize()
        {
            SetStartDate(1994, 2, 1);
            SetEndDate(2025, 11, 10);
            SetCash(100000);
            SetTimeZone(TimeZones.NewYork);
            _spy = AddEquity("SPY", Resolution.Daily).Symbol;
            Settings.SeedInitialPrices = false;
        }

        public override void OnData(Slice slice)
        {
            if (!slice.Bars.ContainsKey(_spy)) return;
            if (Time >= Holdout) return;
            if (!Securities[_spy].HasData) return;
            var history = History(_spy, 253, Resolution.Daily);
            if (history == null) return;
            var closes = new List<decimal>();
            foreach (var bar in history) closes.Add(bar.Close);
            if (closes.Count < 253) return;
            var past = closes[closes.Count - 22];
            var older = closes[closes.Count - 253];
            if (older <= 0) return;
            var signal = past / older - 1m;
            if (!Portfolio.Invested && signal > 0)
            {
                SetHoldings(_spy, 0.95m);
            }
            else if (Portfolio.Invested && signal <= 0)
            {
                Liquidate(_spy);
            }
        }

        public override void OnOrderEvent(OrderEvent fill)
        {
            if (fill.Status != OrderStatus.Filled) return;
            _fills.Add(new Dictionary<string, object>
            {
                { "time", fill.UtcTime.ToString("o") },
                { "price", fill.FillPrice },
                { "quantity", fill.FillQuantity },
                { "direction", fill.Direction.ToString() }
            });
        }

        public override void OnEndOfAlgorithm()
        {
            var payload = new Dictionary<string, object>
            {
                { "engine", "lean" },
                { "strategy", "mom-12-1-portfolio" },
                { "endingEquity", Portfolio.TotalPortfolioValue },
                { "fills", _fills.Count },
                { "holdoutUsed", false }
            };
            File.WriteAllText("/workspace/research/lab/lean-momentum.json", JsonSerializer.Serialize(payload));
        }
    }
}
