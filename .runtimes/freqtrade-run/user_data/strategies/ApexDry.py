from freqtrade.strategy import IStrategy
from pandas import DataFrame


class ApexDry(IStrategy):
    """Research dry-run only. No real orders. Not a validated strategy."""

    INTERFACE_VERSION = 3
    timeframe = "5m"
    can_short = False
    minimal_roi = {"0": 0.02}
    stoploss = -0.01
    startup_candle_count = 30

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["sma"] = dataframe["close"].rolling(20).mean()
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[dataframe["close"] > dataframe["sma"], "enter_long"] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[dataframe["close"] < dataframe["sma"], "exit_long"] = 1
        return dataframe
