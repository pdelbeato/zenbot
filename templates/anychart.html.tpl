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
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-core.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-stock.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-annotations.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-exports.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.7.1/js/anychart-ui.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
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
            d.upperBound=0
            d.midBound=0
            d.midBound=0
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


    var data_chart=[]
    data = data.map(function (d) {
      data_chart.push ([
        d.date,
        d.open,
        d.high,
        d.low,
        d.close
      ]);
      return d
    })
console.log(data_chart)

    rem_index=[];var index_trade=[];var trade_closed=[]


    // create the second Marker annotation

    // var marker2 = controller.marker();
    //
    // // set the position of the second annotation
    // marker2.xAnchor("2007-01-07");
    // marker2.valueAnchor(28.92);
    //
    // // set the type of the second annotation
    // marker2.markerType("arrow-down");
    //
    // // configure the size and offset of the second annotation
    // marker2.size(30);
    // marker2.offsetY(-40);
    //
    // // configure the visual settings of the second annotation
    // marker2.normal().fill("none");
    // marker2.normal().stroke("#006600", 1, "10 2");
    // marker2.hovered().stroke("#00b300", 2, "10 2");
    // marker2.selected().stroke("#00b300", 4, "10 2");

    trades = trades.map(function (t,index) {

      t.date = new Date(t.time)
      if (t.signal === "buy") {
        t.arrows="arrowUp";
        t.background="#00CC00"
      }
      if (t.signal === "sell") {
        t.arrows="arrowDown";
        t.background="#ff0000"
      }
      if (t.time===null) {
          rem_index.push(index)
       }

       index_trade=trades.map(function(e) { return e.id; }).indexOf(t.id)
       if (index_trade!==index) {
         trade_closed.push ({
           "id": t.id,
           "date_open": (trades[index_trade].date).toUTCString(),
           "date_close": (t.date).toUTCString(),
           "exposure": (t.date - trades[index_trade].date),
           "price_open": trades[index_trade].price,
           "price_close": t.price,
           "size": t.size,
           "profit": (Math.round(((t.price - trades[index_trade].price)*t.size) * 100) / 100),
         });

       }
      return t
    })
    console.log(trades)
    var trades_chart=[]
    trades = trades.map(function (t,index) {
      trades_chart.push ({
        xAnchor: t.date,
        valueAnchor: t.price,
//        markerType: "arrow-down",
        size: 20,
        offsetY: 10,
        hovered: {
           fill: "#398cae 0.3",
           stroke: "2 #ff0000",
        },
        selected: {
            fill: "#398cae 0.3",
            hatchFill: "percent75",
            stroke: "4 #ff0000"
          }
        });
      })

      console.log(trades_chart)
      // set the data
      table = anychart.data.table();
      table.addData(data_chart);
  //     table.addData([
  // ['2004-03-29', 92.99, 93.61, 92.18, 92.68],
  // ['2004-03-30', 92.67, 92.67, 91.35, 92.32],
  // ['2004-03-31', 92.07, 92.24, 91.51, 91.84]
  //     ]);

      // map the data
      mapping = table.mapAs();
      mapping.addField('open', 1);
      mapping.addField('high', 2);
      mapping.addField('low', 3);
      mapping.addField('close', 4);

      // chart type
      var chart = anychart.stock();





      // create a plot on the chart
      var plot = chart.plot(0);

      // create Bollinger Bands indicator
      //chart.plot(0).bbands(mapping);
      var bbands = plot.bbands(mapping, 20, 2, "line", "line", "line");

      // color the series
      bbands.upperSeries().stroke('#bf360c');
      bbands.middleSeries().stroke('#ff6600');
      bbands.lowerSeries().stroke('#bf360c');
      bbands.rangeSeries().fill('#ffd54f 0.2');


      // // create a line series
      // var lineSeries = plot.line(mapping);
      // lineSeries.name("CSCO");
      // access the annotations() object of the plot to work with annotations
      var controller = plot.annotations();

      // create the first Marker annotation and configure its size, offset and visual settings
      controller.marker(trades_chart);




      var rangePicker = anychart.ui.rangePicker();
      var rangeSelector = anychart.ui.rangeSelector();
      // set the series
      var series = chart.plot(0).candlestick(mapping);
      series.name("Stock prices");

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
