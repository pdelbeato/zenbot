<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{symbol}} sim result</title>
  <style type="text/css">
  html, body, #container {
    width: 100%;
    height: 80%;
    margin: 0;
    padding: 0;
}
  </style>
</head>
<body>
</script>
  <div id="container"></div>
  <script src="https://cdn.anychart.com/releases/8.9.0/js/anychart-base.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.9.0/js/anychart-exports.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>
  <script src="https://cdn.anychart.com/releases/8.9.0/js/anychart-ui.min.js?hcode=a0c21fc77e1449cc86299c5faa067dc4"></script>


  <script type="text/javascript">


    var withData = function (data_daily_gain,data_monthly_gain) {

      console.log(data_monthly_gain)
      console.log(data_daily_gain)

      var data= data_daily_gain.map(function (d) {
        d.capital_currency = parseFloat(d.capital_currency)
        d.capital_asset = parseFloat(d.capital_asset)
        d.profit = parseFloat(d.profit)
        d.buy_hold= parseFloat(d.buy_hold)
        d.buy_hold_profit = parseFloat(d.buy_hold_profit)
        
        return d
        })
        
      anychart.onDocumentReady(function() {
        anychart.theme(anychart.themes.darkEarth);
   


   // create a data set
   var dataSet = anychart.data.set(data);


//    console.log (dataSet)

//   var dataSet1 = anychart.data.set([
//     ['P1', 969.5, 2040, 1200, 1600, 2000],
//     ['P2', 779.1, 1794, 1124, 1724, 4000],
//     ['P3', 739.2, 2026, 1006, 1806, 5000]
//   ]);
//   console.log (dataSet1)
//    // map the data
 var seriesData_1 = dataSet.mapAs({x: "day", value: "capital_currency"});
 var seriesData_2 = dataSet.mapAs({x: "day", value: "capital_asset"});
var seriesData_3 = dataSet.mapAs({x: "day", value: "profit"});
var seriesData_4 = dataSet.mapAs({x: "day", value: "buy_hold"});
var seriesData_5 = dataSet.mapAs({x: "day", value: "buy_hold_profit"});
//   var seriesData_4 = dataSet.mapAs({x: [0], value: [4]})


  // create a chart
  var chart = anychart.column();
  chart.animation(true);

//   var scale = anychart.scales.linear();
//   scale.stackMode('capital_currency');

// turn on X Scroller
chart.xScroller(true);

// disable X Scroller
chart.xScroller().enabled(false);

// create a series and set the data
    var series1 = chart.area(seriesData_5);
    series1.name("Buy&Hold");
    //series1.yScale(scale);

//     var scale1 = anychart.scales.linear();
//   scale1.stackMode('profit');
     var areaSeries2 = chart.area(seriesData_3);
     areaSeries2.name("Zenbot");
     areaSeries2.normal().hatchFill("zig-zag", "#808080", 1, 15);
     areaSeries2.hovered().hatchFill("zig-zag", "#808080", 1, 15);
     areaSeries2.selected().hatchFill("zig-zag", "#808080", 1, 15);
//      areaSeries2.yScale(scale1);


    // enable the legend
    chart.legend(true);
    // set the chart title
    chart.title("Profit");

    // set the container id
    chart.container("container");

    // initiate drawing the chart
    chart.draw();
      // create a chart
  var chart1 = anychart.column();
  chart1.animation(true);
  // create a series and set the data
  var series1 = chart1.area(seriesData_1);
      // set the container id
      chart1.container("container");
      chart.title("Capital");
// initiate drawing the chart
chart1.draw();

});
  };</script></body>
  <script>
{{code}}
//withData(data, trades, options)
  </script>
  <body onload="withData(data_daily_gain,data_monthly_gain)">

  <!-- <pre><code>{{output}}</code></pre> -->
  </body>
  </html>
