<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{symbol}} sim result</title>
  <style type="text/css">
  html, body {
    width: 100%;
    height: 100%;
    margin: 0px;
  }

  #chartdiv {
      width: 100%;
      height: 100%;
  }
  </style>
</head>
<body>
<script src="https://www.amcharts.com/lib/3/amcharts.js"></script>
<script src="https://www.amcharts.com/lib/3/serial.js"></script>
<script src="https://d3js.org/d3.v4.min.js"></script>
<script src="https://www.amcharts.com/lib/3/plugins/export/export.min.js"></script>
<link rel="stylesheet" href="https://www.amcharts.com/lib/3/plugins/export/export.css" type="text/css" media="all" />
<div id="chartdiv"></div>
  <script>
var withData = function (data, trades) {
  data = data.map(function (d) {
    d.date = new Date(d.time)
    d.upperBound=d.bollinger.upperBound
    d.midBound=d.bollinger.midBound
    d.lowerBound=d.bollinger.lowerBound
    return d
  })
data=data.reverse();
var stockEvents = [ {
  "date": data[10].date,
  "type": "flag",
  "backgroundColor": "#85CDE6",
  "graph": "g3",
  "text": "S",
  "description": "This is description of an event"
}]

var chart = AmCharts.makeChart( "chartdiv", {


  "type": "serial",
  "theme": "none",
  "dataDateFormat":"YYYY-MM-DD",
  "valueAxes": [ {
    "position": "left"
  } ],
  "graphs": [ {
    "id": "g1",
    "balloonText": "Open:<b>[[open]]</b><br>Low:<b>[[low]]</b><br>High:<b>[[high]]</b><br>Close:<b>[[close]]</b><br>",
  //  "labelText": "test",
    "closeField": "close",
    "fillColors": "#56d317",
    "highField": "high",
    "lineColor": "#000000",
    "lineAlpha": 1,
    "lowField": "low",
    "fillAlphas": 0.9,
    "negativeFillColors": "#ff0000",
    "negativeLineColor": "#000000",
    "openField": "open",
    "title": "Price:",
    "type": "candlestick",
    "valueField": "close"
  },{
    "id": "g2",
    "bullet": "round",
    "bulletBorderAlpha": 1,
    "bulletColor": "#00FF00",
    "bulletSize": 5,
    "hideBulletsCount": 50,
    "lineThickness": 1,
    "title": "media",
    "useLineColorForBulletBorder": true,
    "lineColor": "#f44242",
    "valueField": "midBound"
  },{
    "id": "g3",
    "bullet": "round",
    "bulletBorderAlpha": 1,
    "bulletColor": "#00FF00",
    "bulletSize": 5,
    "hideBulletsCount": 50,
    "lineThickness": 2,
    "title": "media",
    "useLineColorForBulletBorder": true,
    "lineColor": "#426ed1",
    "valueField": "upperBound"
  },{
    "id": "g4",
    "bullet": "round",
    "bulletBorderAlpha": 1,
    "bulletColor": "#00FF00",
    "bulletSize": 5,
    "hideBulletsCount": 50,
    "lineThickness": 2,
    "title": "media",
    "useLineColorForBulletBorder": true,
    "lineColor": "#426ed1",
    "valueField": "lowerBound"
  },{
    "id": "fromGraph",
    "lineAlpha": 0,
    "fillColors": "#91b3ff",
    "showBalloon": false,
    "valueField": "lowerBound",
    "fillAlphas": 0
    },{
    "fillAlphas": 0.2,
    "fillColors": "#91b3ff",
    "fillToGraph": "fromGraph",
    "lineAlpha": 0,
    "showBalloon": false,
    "valueField": "upperBound"
    }


  ],
  "chartScrollbar": {
    "graph": "g1",
    "graphType": "line",
    "scrollbarHeight": 30
  },
  "chartCursor": {
    "valueLineEnabled": true,
    "valueLineBalloonEnabled": true
  },
  "categoryField": "date",
  "categoryAxis": {
    "parseDates": false
  },
  "dataProvider": data,

  "stockEvents": stockEvents,

  "export": {
    "enabled": true,
    "position": "bottom-right"
  },

} );

chart.addListener( "rendered", zoomChart );
zoomChart();

// this method is called when chart is first inited as we listen for "dataUpdated" event
function zoomChart() {
  // different zoom methods can be used - zoomToIndexes, zoomToDates, zoomToCategoryValues
  chart.zoomToIndexes( chart.dataProvider.length - 10, chart.dataProvider.length - 1 );
}
}
  </script>
  <script>
{{code}}
withData(data, trades)
  </script>
  <pre><code>{{output}}</code></pre>
</body>
</html>
