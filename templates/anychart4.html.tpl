<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{symbol}} sim result</title>
  <style type="text/css">
  html, body, #container {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
}
  </style>
</head>
<body>
  <script>(function(){
function ac_add_to_head(el){
	var head = document.getElementsByTagName('head')[0];
	head.insertBefore(el,head.firstChild);
}
function ac_add_link(url){
	var el = document.createElement('link');
	el.rel='stylesheet';el.type='text/css';el.media='all';el.href=url;
	ac_add_to_head(el);
}
function ac_add_style(css){
	var ac_style = document.createElement('style');
	if (ac_style.styleSheet) ac_style.styleSheet.cssText = css;
	else ac_style.appendChild(document.createTextNode(css));
	ac_add_to_head(ac_style);
}
ac_add_link('https://cdn.anychart.com/releases/8.7.1/css/anychart-ui.min.css?hcode=a0c21fc77e1449cc86299c5faa067dc4');
ac_add_style(document.getElementById("ac_style_samples-stock-range-selection-01").innerHTML);
ac_add_style(".anychart-embed-samples-stock-range-selection-01{width:600px;height:450px;}");
})();</script>
  <div id="container"></div>
  <!-- <script src="https://cdn.anychart.com/releases/v8/js/anychart-base.min.js?hcode=c11e6e3cfefb406e8ce8d99fa8368d33"></script> -->
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-core.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-stock.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-annotations.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-exports.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-ui.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-cartesian.min.js"></script>
  <div id="ac_style_samples-stock-range-selection-01" style="display:none;">
  html, body, #container {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
  }
  </div>
  <script type="text/javascript">


    var withData = function (data, trades_chart_buy, trades_chart_sell, data_markers_buy, options) {
      console.log(trades_chart_buy[1][0])
      console.log(trades_chart_sell)

  var i =0; var strategy_sel =[]
  Object.keys(options.chart).map(function (key) {
    var strategy=key
    Object.keys(options.chart[strategy].data).map(function (sub_key) {
      i++

      strategy_sel[i-1]=sub_key
    })
    })



    anychart.onDocumentReady(function () {
    //data=data.reverse();
    data_chart=data
    rem_index=[];var index_trade=[];var trade_closed=[]

      // set the data
      table = anychart.data.table();
      table.addData(data_chart);

      // table_period = anychart.data.table();
      // table_period.addData(data_chart_period);

      table_trades_buy = anychart.data.table();
      table_trades_buy.addData(trades_chart_buy);

      table_trades_sell = anychart.data.table();
      table_trades_sell.addData(trades_chart_sell);

      // map the data
      mapping = table.mapAs();
      mapping.addField('open', 1);
      mapping.addField('high', 2);
      mapping.addField('low', 3);
      mapping.addField('close', 4);
      //mapping.addField('volume',8)

      // // map the data in the strategy period
      // mapping_period = table_period.mapAs();
      // mapping_period.addField('open', 1);
      // mapping_period.addField('high', 2);
      // mapping_period.addField('low', 3);
      // mapping_period.addField('close', 4);

      // map the trades
      mapping_trades_buy = table_trades_buy.mapAs();
      mapping_trades_buy.addField('value', 1);

      mapping_trades_sell = table_trades_sell.mapAs();
      mapping_trades_sell.addField('value', 1);



      // chart type
      var chart = anychart.stock();


      if (strategy_sel.includes('bollinger')) {
      // map the data Bollinger
        mapping_BBu = table.mapAs();
        mapping_BBu.addField('value', 5);
        mapping_BBm = table.mapAs();
        mapping_BBm.addField('value', 6);
        mapping_BBd = table.mapAs();
        mapping_BBd.addField('value', 7);

        // set the series
        var series_BBu = chart.plot(0).line(mapping_BBu);
        series_BBu.name("BB upper");
        var series_BBm = chart.plot(0).line(mapping_BBm);
        series_BBm.name("BB middle");
        var series_BBd = chart.plot(0).line(mapping_BBd);
        series_BBd.name("BB lower");

      }

      if (strategy_sel.includes('stoch')) {
        // map the data Stochastic
          mapping_Stoch_K = table.mapAs();
          mapping_Stoch_K.addField('value', 8);

          // set the series
          var series_Stoch_K = chart.plot(1).line(mapping_Stoch_K);
          series_Stoch_K.name("Stoch K");
          }






      // create a plot on the chart
      var plot = chart.plot(0);
      // //
      // // create Bollinger Bands indicator
      // //chart.plot(0).bbands(mapping_period);
      // var bbands = plot.bbands(mapping 20, 2, "line", "line", "line");
      // //
      // // color the series
      // bbands.upperSeries().stroke('#bf360c');
      // bbands.middleSeries().stroke('#ff6600');
      // bbands.lowerSeries().stroke('#bf360c');
      // //bbands.rangeSeries().fill('#ffd54f 0.2');

      // set the series
      var series_trades_buy = chart.plot(0).marker(mapping_trades_buy);
      series_trades_buy.size(7)
      series_trades_buy.fill("#0BE518")
      series_trades_buy.name("BUY_trades");
      series_trades_buy.stroke({color: '#000000', thickness: 1, lineCap: 'round'});
      var series_trades_sell = chart.plot(0).marker(mapping_trades_sell);
      series_trades_sell.name("SELL_trades");
      series_trades_sell.fill("#FF0000")
      series_trades_sell.size(7)
      series_trades_sell.stroke({color: '#000000', thickness: 1,  lineCap: 'round'});

      var rangePicker = anychart.ui.rangePicker();
      var rangeSelector = anychart.ui.rangeSelector();




      // set the series
      var series = chart.plot(0).candlestick(mapping);
      series.name("Stock prices");


      //add event markers
      var data_markers=[
        {
          "format": "B",
          "data": data_markers_buy
        },
        {
          "format": "S",
          "data": data_markers_sell
        }
      ]

      plot.eventMarkers({"groups": data_markers});
      // bind event markers to the first series
      plot.eventMarkers().position("series");
      plot.eventMarkers().seriesId(0);

      // // create the second plot on the chart
      // var plot_1 = chart.plot(1);

      // create a Volume + MA indicator
      // var volumeMa = plot_1.volumeMa(mapping);
      // volumeMa.volumeSeries().stroke(null);
      // volumeMa.volumeSeries().fill("#00838f 0.4");
      //volumeMa.maSeries().stroke("1.5 #00838f");

      chart.title('Stock Candlestick Simulation: Stock prices \n(Array data notation)');
      chart.container('container');

      chart.draw();



      // // Render the range picker into an instance of a stock chart
      rangePicker.render(chart);
      rangeSelector.render(chart);



      })
  };</script></body>
  <script>
{{code}}
//withData(data, trades, options)
  </script>
  <body onload="withData(data, trades_chart_buy, trades_chart_sell, data_markers_buy, options)">

  <!-- <pre><code>{{output}}</code></pre> -->
  </body>
  </html>
