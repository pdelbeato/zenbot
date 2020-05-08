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


    var withData = function (data, trades, options) {



      anychart.onDocumentReady(function () {
    //data=data.reverse();

    close_ref=data[0].close;

    data = data.map(function (d) {
      d.date = new Date(d.time)
      if (typeof d.strategy === 'object') {
        if (typeof d.strategy.bollinger.data.bollinger === 'object') {
          d.upperBound=d.strategy.bollinger.data.bollinger.upperBound
          d.midBound=d.strategy.bollinger.data.bollinger.midBound
          d.lowerBound=d.strategy.bollinger.data.bollinger.lowerBound
          } else {
            d.upperBound=d.open
            d.midBound=d.open
            d.lowerBound=d.open
            }

        if (d.upperBound - d.lowerBound>0 && d.midBound!==0) {
          d.boll_perc_B= (d.close - d.lowerBound ) / (d.upperBound - d.lowerBound)
          d.BB_band=(d.upperBound - d.lowerBound)/d.midBound
        } else {
          d.boll_perc_B=0
          }
        }
      d.close_norm=d.close/close_ref
      return d
    })

    console.log(data)

    var i= 0;
    var data_chart=[];data_chart_period=[]
    data = data.map(function (d) {
      i++
      if (i% 15 == 0) {
        data_chart_period.push ([
          d.date,
          d.open,
          d.high,
          d.low,
          d.close,
          d.upperBound,
          d.midBound,
          d.lowerBound,
          d.volume
        ]);
        }
      data_chart.push ([
        d.date,
        d.open,
        d.high,
        d.low,
        d.close,
        d.upperBound,
        d.midBound,
        d.lowerBound,
        d.volume
      ]);
      return d
    })
console.log(data_chart)
console.log(data_chart_period)

    rem_index=[];var index_trade=[];var trade_closed=[]



    var trades_chart_buy=[];var trades_chart_sell=[]
    trades = trades.map(function (t,index) {

      t.date = new Date(t.time)
      if (t.signal === "buy") {
        trades_chart_buy.push ([
          t.date,
          t.price
        ]);
      }
      if (t.signal === "sell") {
        trades_chart_sell.push ([
          t.date,
          t.price
        ]);
      }
      if (t.time===null) {
          rem_index.push(index)
       }

       // index_trade=trades.map(function(e) { return e.id; }).indexOf(t.id)
       // if (index_trade!==index) {
       //   trade_closed.push ({
       //     "id": t.id,
       //     "date_open": (trades[index_trade].date).toUTCString(),
       //     "date_close": (t.date).toUTCString(),
       //     "exposure": (t.date - trades[index_trade].date),
       //     "price_open": trades[index_trade].price,
       //     "price_close": t.price,
       //     "size": t.size,
       //     "profit": (Math.round(((t.price - trades[index_trade].price)*t.size) * 100) / 100),
       //   });
       //
       // }
      return t
    })
    console.log(trades)




      // set the data
      table = anychart.data.table();
      table.addData(data_chart);

      table_period = anychart.data.table();
      table_period.addData(data_chart_period);

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
      mapping.addField('volume',8)



      // map the data
      mapping_period = table_period.mapAs();
      mapping_period.addField('open', 1);
      mapping_period.addField('high', 2);
      mapping_period.addField('low', 3);
      mapping_period.addField('close', 4);

      // map the data
      mapping_trades_buy = table_trades_buy.mapAs();
      mapping_trades_buy.addField('value', 1);
      mapping_trades_sell = table_trades_sell.mapAs();
      mapping_trades_sell.addField('value', 1);



      // map the data
        mapping_BBu = table.mapAs();
        mapping_BBu.addField('value', 5);
        mapping_BBm = table.mapAs();
        mapping_BBm.addField('value', 6);
        mapping_BBd = table.mapAs();
        mapping_BBd.addField('value', 7);




      // chart type
      var chart = anychart.stock();

      // set the series
      var series_BBu = chart.plot(0).line(mapping_BBu);
      series_BBu.name("BB upper");
      var series_BBm = chart.plot(0).line(mapping_BBm);
      series_BBm.name("BB middle");
      var series_BBd = chart.plot(0).line(mapping_BBd);
      series_BBd.name("BB lower");


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
      series_trades_buy.size(10)
      series_trades_buy.fill("#0BE518")
      series_trades_buy.name("BUY_trades");
      series_trades_buy.stroke({color: '#000000', thickness: 1, lineCap: 'round'});
      var series_trades_sell = chart.plot(0).marker(mapping_trades_sell);
      series_trades_sell.name("SELL_trades");
      series_trades_sell.fill("#FF0000")
      series_trades_sell.size(10)
      series_trades_sell.stroke({color: '#000000', thickness: 1,  lineCap: 'round'});

      var rangePicker = anychart.ui.rangePicker();
      var rangeSelector = anychart.ui.rangeSelector();




      // set the series
      var series = chart.plot(0).candlestick(mapping);
      series.name("Stock prices");



      // create the second plot on the chart
      var plot_1 = chart.plot(1);

      // create a Volume + MA indicator
      var volumeMa = plot_1.volumeMa(mapping);
      volumeMa.volumeSeries().stroke(null);
      volumeMa.volumeSeries().fill("#00838f 0.4");
      volumeMa.maSeries().stroke("1.5 #00838f");

      chart.title('Stock Candlestick Simulation: Stock prices \n(Array data notation)');
      chart.container('container');

      chart.draw();



      // Render the range picker into an instance of a stock chart
      rangePicker.render(chart);
      rangeSelector.render(chart);

      })
  };</script></body>
  <script>
{{code}}
//withData(data, trades, options)
  </script>
  <body onload="withData(data, trades, options)">

  <!-- <pre><code>{{output}}</code></pre> -->
  </body>
  </html>
