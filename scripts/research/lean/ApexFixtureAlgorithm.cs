/*
 * Apex research fixture for the pinned QuantConnect LEAN launcher.
 * Apache-2.0 LEAN types are referenced, not copied.
 * Simulated backtest fills stay inside LEAN. This algorithm has no brokerage key
 * and must be launched with environment=backtesting.
 */
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using QuantConnect;
using QuantConnect.Algorithm;
using QuantConnect.Data;
using QuantConnect.Orders;

namespace Apex.Research
{
    public class ApexFixtureAlgorithm : QCAlgorithm
    {
        private Symbol _symbol;
        private int _seen;
        private readonly List<Dictionary<string, object>> _fills = new List<Dictionary<string, object>>();

        public override void Initialize()
        {
            SetStartDate(2024, 1, 2);
            SetEndDate(2024, 1, 2);
            SetCash(100000);
            SetTimeZone(TimeZones.NewYork);
            _symbol = AddData<ApexBar>("FIXTURE", Resolution.Minute, TimeZones.NewYork).Symbol;
            Settings.SeedInitialPrices = false;
        }

        public override void OnData(Slice slice)
        {
            var bar = slice.Get<ApexBar>().GetValue(_symbol);
            if (bar == null) return;
            _seen++;
            if (_seen == 1 && bar.Close > bar.Open && !Portfolio.Invested)
            {
                MarketOrder(_symbol, 100);
            }
            else if (_seen == 3 && Portfolio.Invested)
            {
                Liquidate(symbol: _symbol, tag: "fixture-exit");
            }
        }

        public override void OnOrderEvent(OrderEvent orderEvent)
        {
            if (orderEvent.Status != OrderStatus.Filled) return;
            _fills.Add(new Dictionary<string, object>
            {
                { "orderId", orderEvent.OrderId },
                { "utc", orderEvent.UtcTime.ToString("o") },
                { "fillPrice", orderEvent.FillPrice },
                { "fillQuantity", orderEvent.FillQuantity },
                { "orderFee", orderEvent.OrderFee.Value.Amount },
                { "direction", orderEvent.Direction.ToString() }
            });
        }

        public override void OnEndOfAlgorithm()
        {
            var payload = new Dictionary<string, object>
            {
                { "engine", "lean" },
                { "pin", "655ac6d475ad8539ff54583a26327e63b59c5703" },
                { "algorithm", "ApexFixtureAlgorithm" },
                { "dataset", "synthetic-custom-data" },
                { "brokerOrders", false },
                { "barsSeen", _seen },
                { "tradeCount", _fills.Count / 2 },
                { "fills", _fills },
                { "netProfit", Portfolio.TotalNetProfit },
                { "equity", Portfolio.TotalPortfolioValue },
                { "holdings", Portfolio[_symbol].Quantity },
                { "cash", Portfolio.Cash }
            };
            var path = Path.Combine(Globals.DataFolder, "..", "apex-lean-summary.json");
            File.WriteAllText(Path.GetFullPath(path), JsonSerializer.Serialize(payload));
            Log("APEX_LEAN_SUMMARY bars=" + _seen + " net=" + Portfolio.TotalNetProfit.ToString(CultureInfo.InvariantCulture) + " fills=" + _fills.Count);
        }
    }

    public class ApexBar : BaseData
    {
        public decimal Open { get; set; }
        public decimal High { get; set; }
        public decimal Low { get; set; }
        public decimal Close { get; set; }

        public override DateTime EndTime
        {
            get { return Time.AddMinutes(1); }
            set { Time = value.AddMinutes(-1); }
        }

        public override bool IsSparseData()
        {
            return true;
        }

        public override SubscriptionDataSource GetSource(SubscriptionDataConfig config, DateTime date, bool isLiveMode)
        {
            var source = Path.Combine(Globals.DataFolder, "custom", "apexfixture", "fixture.csv");
            return new SubscriptionDataSource(source, SubscriptionTransportMedium.LocalFile, FileFormat.Csv);
        }

        public override BaseData Reader(SubscriptionDataConfig config, string line, DateTime date, bool isLiveMode)
        {
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#")) return null;
            var csv = line.Split(',');
            if (csv.Length < 6) return null;
            var close = decimal.Parse(csv[4], CultureInfo.InvariantCulture);
            return new ApexBar
            {
                Symbol = config.Symbol,
                Time = DateTime.ParseExact(csv[0], "yyyyMMdd HH:mm", CultureInfo.InvariantCulture),
                Open = decimal.Parse(csv[1], CultureInfo.InvariantCulture),
                High = decimal.Parse(csv[2], CultureInfo.InvariantCulture),
                Low = decimal.Parse(csv[3], CultureInfo.InvariantCulture),
                Close = close,
                Value = close
            };
        }
    }
}
