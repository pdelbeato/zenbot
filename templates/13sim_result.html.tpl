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


#chartdiv2 {
  width: 100%;
  height: 500px;
}

#chartdiv3 {
  width: 100%;
  height: 500px;
}


body {
  background-color: #ffffff;
}
body * {
  box-sizing: border-box;
}

.header {
  background-color: #327a81;
  color: white;
  font-size: 1.5em;
  padding: 1rem;
  text-align: center;
  text-transform: uppercase;
}

*, *:after, *:before {
	-webkit-box-sizing: border-box;
	-moz-box-sizing: border-box;
	box-sizing: border-box;
}


table {
	border-collapse: collapse;
	border-spacing: 0;
	background:#fff;
	margin:auto;
}


a {
	color: #36c;
	text-decoration: none;
}

a:focus {
	outline: thin dotted;
}

a:hover,
a:active {
	outline: 0;
}

a:active,
a:hover {
	color: #5c85d6;
}

h1,
h2,
h3,
h4,
h5,
h6 {
	clear: both;
	font-weight: 700;
	margin:0 0 15px 0;
	font-weight:normal;
}

h1 {
	font-size: 24px;
	line-height: 1.3846153846;
	color:#000
}

h2 {
	font-size: 24px;
	line-height: 1;
	color:#333
}

h3 {
	font-size: 20px;
	line-height: 1.0909090909;
	color:#555
}

h4 {
	font-size: 16px;
	line-height: 1.2;
}

h5 {
	font-size: 18px;
	line-height: 1.3333333333;
}

h6 {
	font-size: 16px;
	line-height: 1.5;
}



b,
strong {
	font-weight: 700;
}

cite,
dfn,
em,
i {
	font-style: italic;
}

mark,
ins {
	background: #fff9c0;
	text-decoration: none;
}
p,li{
	line-height:17px;
}
p {
	margin-bottom: 15px;
}

code,
kbd,
tt,
var,
samp,
pre {
	font-family: monospace, serif;
	font-size: 15px;
	-webkit-hyphens: none;
	-moz-hyphens:    none;
	-ms-hyphens:     none;
	hyphens:         none;
	line-height: 1.6;
}


pre {
	border: 1px solid rgba(0, 0, 0, 0.1);
	-webkit-box-sizing: border-box;
	-moz-box-sizing:    border-box;
	box-sizing:         border-box;
	margin-bottom: 24px;
	max-width: 100%;
	overflow: auto;
	padding: 12px;
	white-space: pre;
	white-space: pre-wrap;
	word-wrap: break-word;
}

blockquote,
q {
	-webkit-hyphens: none;
	-moz-hyphens:    none;
	-ms-hyphens:     none;
	hyphens:         none;
	quotes: none;
}

blockquote:before,
blockquote:after,
q:before,
q:after {
	content: "";
	content: none;
}

blockquote {
	color: #767676;
	font-size: 19px;
	font-style: italic;
	font-weight: 300;
	line-height: 1.2631578947;
	margin-bottom: 24px;
}

blockquote cite,
blockquote small {
	color: #2b2b2b;
	font-size: 16px;
	font-weight: 400;
	line-height: 1.5;
}

blockquote em,
blockquote i,
blockquote cite {
	font-style: normal;
}

blockquote strong,
blockquote b {
	font-weight: 400;
}

small {
	font-size: 11px;
	color:#999;
}
.weak{
	color:#666
}
.strike{
	text-decoration:line-through;
}
.relative{
	position:relative;
}
big {

	font-size: 125%;
}

sup,
sub {
	font-size: 75%;
	height: 0;
	line-height: 0;
	position: relative;
	vertical-align: baseline;
}

sup {
	bottom: 1ex;
}

sub {
	top: .5ex;
}

dt {
	font-weight: bold;
}



ul,
ol {
	list-style: none;
	margin: 0;
}

ul {
	list-style: disc;
}

ol {
	list-style: decimal;
}

li > ul,
li > ol {
	margin: 0 0 0 0px;
}

img {
	-ms-interpolation-mode: bicubic;
	border: 0;
	vertical-align: middle;
	max-width:100%;
}




table,
th,
td {
	border: 1px solid rgba(0, 0, 0, 0.1);
}

table {
	border-collapse: separate;
	border-spacing: 0;
	border-width: 1px 0 0 1px;
	margin-bottom: 24px;
	width: 100%;
}

caption,
th,
td {
	font-weight: normal;
	text-align: left;
	padding:5px 10px;
}

th {
	border-width: 0 1px 1px 0;
	font-weight: bold;
}

td {
	border-width: 0 1px 1px 0;
}

del {
	color: #767676;
}

hr {
	background-color: rgba(0, 0, 0, 0.1);
	border: 0;
	height: 1px;
	margin-bottom: 23px;
}


header {
    background: #fff;
	text-align:center;
}

header small{
   display:block;
}
.body{
	margin-top:30px;
	margin-bottom:30px;
	min-height:420px;
}
footer {
    background: #000;
	color:#fff;
	text-align:center;
	border-top:1px solid #ddd;
	padding:20px 0;
}
footer  p{
    margin:0;
}

.intro{
	font-size:17px;
	line-height:21px;
	margin-bottom:30px;

}

/* custom styles */
.req{
	font-weight:bold;
}
.fLeft{
	float:left;
}
.fRight{
	float:right;
}
.tRight{
	text-align:right;
}
.tCenter{
	text-align:center;
}

.grid {
		width: 100%;
		max-width: 940px;
		min-width: 320px;
		margin: 0 auto;
		overflow: hidden;
	}



  </style>
</head>
<body>
<script src="https://www.amcharts.com/lib/3/amcharts.js"></script>
<script src="https://www.amcharts.com/lib/3/serial.js"></script>
<script src="https://www.amcharts.com/lib/3/amstock.js"></script>
<script src="https://d3js.org/d3.v4.min.js"></script>
<script src="https://www.amcharts.com/lib/3/plugins/export/export.min.js"></script>
<script src="https://www.amcharts.com/lib/4/core.js"></script>
<script src="https://www.amcharts.com/lib/4/charts.js"></script>
<script src="https://www.amcharts.com/lib/4/themes/animated.js"></script>
<link rel="stylesheet" href="https://www.amcharts.com/lib/3/plugins/export/export.css" type="text/css" media="all" />
<h2 style="color: #2e6c80; text-align: center;">Candelstick and Stock Events
</h2>
<div style="padding-bottom: 5px;">
<input type="button" class="amChartsButton" id="addPanelButton" value="Volume" onclick="addPanel('Volume');">
<input type="button" class="amChartsButton" id="addPanelButton" value="%B" onclick="addPanel('%B');">
<input type="button" class="amChartsButton" id="addPanelButton" value="BB Band" onclick="addPanel('BBBand');">
<!-- <input type="button" class="amChartsButton" id="removePanelButton" value="remove panel" onclick="removePanels();"> -->
</div>

<div id="chartdiv"></div>
<h2 style="color: #2e6c80; text-align: center;">Buy &amp; Hold&nbsp; &nbsp; VS&nbsp; &nbsp;Strategy</h2>
<div id="chartdiv2"></div>
<h2 style="color: #2e6c80; text-align: center;">Quantum performance</h2>
<div id="chartdiv3"></div>

  <script>

var withData = function (data, trades, options) {

data=data.reverse();
close_ref=data[0].close;
data = data.map(function (d) {
  d.date = new Date(d.time)
  if (typeof d.strategy === 'object') {
    d.upperBound=d.strategy.bollinger.data.upperBound
    d.midBound=d.strategy.bollinger.data.midBound
    d.lowerBound=d.strategy.bollinger.data.lowerBound
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

//console.log(data)
rem_index=[];var index_trade=[];var trade_closed=[]

trades = trades.map(function (t,index) {

  t.date = new Date(t.time)
  if (t.side === "buy") {
    t.arrows="arrowUp";
    t.background="#00CC00"
  }
  if (t.side === "sell") {
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
console.log(trade_closed)




var noOftrade_closed = trade_closed.length;

if(noOftrade_closed>0){



  // CREATE DYNAMIC TABLE.
  var table = document.createElement("table");
  table.style.width = '50%';
  table.setAttribute('border', '1');
  table.setAttribute('cellspacing', '0');
  table.setAttribute('cellpadding', '5');

  // retrieve column header ('Name', 'Email', and 'Mobile')

  var col = []; // define an empty array
  for (var i = 0; i < noOftrade_closed; i++) {
    for (var key in trade_closed[i]) {
      if (col.indexOf(key) === -1) {
        col.push(key);
      }
    }
  }

  // CREATE TABLE HEAD .
  var tHead = document.createElement("thead");


  // CREATE ROW FOR TABLE HEAD .
  var hRow = document.createElement("tr");

  // ADD COLUMN HEADER TO ROW OF TABLE HEAD.
  for (var i = 0; i < col.length; i++) {
      var th = document.createElement("th");
      th.innerHTML = col[i];
      hRow.appendChild(th);
  }
  tHead.appendChild(hRow);
  table.appendChild(tHead);

  // CREATE TABLE BODY .
  var tBody = document.createElement("tbody");

  // ADD COLUMN HEADER TO ROW OF TABLE HEAD.
  for (var i = 0; i < noOftrade_closed; i++) {

      var bRow = document.createElement("tr"); // CREATE ROW FOR EACH RECORD .


      for (var j = 0; j < col.length; j++) {
        var td = document.createElement("td");
        td.innerHTML = trade_closed[i][col[j]];
        bRow.appendChild(td);
      }
      tBody.appendChild(bRow)

  }
  table.appendChild(tBody);


  // FINALLY ADD THE NEWLY CREATED TABLE WITH JSON DATA TO A CONTAINER.
  var divContainer = document.getElementById("trade_closed");
  divContainer.innerHTML = "";
  divContainer.appendChild(table);

}




rem_index.reverse().forEach(function(element) {
  trades.splice(element,1);
  });


  //console.log(trades)

//var data_trades = data.concat(trades);
//console.log(data_trades)
init_currency=[];init_asset=[];init_currency[0]=10000;init_asset[0]=1;
var i;stock_Events=[];graph_realcapital=[];graph_quantum=[]
for (i = 0; i < trades.length; i++) {
  stock_Events.push ({
    "date": trades[i].date,
    "type": trades[i].arrows,
    "backgroundColor": trades[i].background,
    "graph": "g1",
    "description": trades[i].id
  });
if (trades[i].side==="buy") {
  stepC_c= -1*parseFloat(trades[i].value)
  stepC_a= parseFloat(trades[i].size)
}
if (trades[i].side==="sell") {
  stepC_c= parseFloat(trades[i].value)
  stepC_a= -1*parseFloat(trades[i].size)
}
if (i===0) {
  init_asset[i]=init_asset[0]
  init_currency[i]=init_currency[0]
  realcapital= (init_asset[i]*data[i].close+init_currency[i])/(init_asset[0]*data[0].close+init_currency[0])
  } else {
    init_asset[i]=init_asset[i-1]+stepC_a
    init_currency[i]=init_currency[i-1]+stepC_c
    realcapital= (init_asset[i]*trades[i].price+init_currency[i])/(init_asset[0]*data[0].close+init_currency[0])
    }
  graph_realcapital.push ({
      "value":realcapital,
      "date": trades[i].date
    })

  if (trades[i].profit !==null) {
    graph_quantum.push ({
        "id":trades[i].id,
        "profit":trades[i].profit
      })
      }
}

var chart = AmCharts.makeChart( "chartdiv", {

  "type": "stock",
  "theme": "light",
  //"dataDateFormat" : "YYYY-MM-DD",
//   "chartCursorSettings": {
//   "pan": true
// },
"categoryAxesSettings": {
  "minPeriod": "mm",
  "groupToPeriods":[ "mm", "15mm", "hh", "DD"]
},
 // "categoryAxesSettings": {
 //    // "maxSeries": 0,
 //    // "minPeriod": "mm",
 //    "groupToPeriods":["mm", "15mm"]
 //   },

  "dataSets": [ {
    "fieldMappings": [ {
      "fromField": "open",
      "toField": "open"
    }, {
      "fromField": "close",
      "toField": "close"
    }, {
      "fromField": "high",
      "toField": "high"
    }, {
      "fromField": "low",
      "toField": "low"
    }, {
      "fromField": "volume",
      "toField": "volume"
    }, {
      "fromField": "upperBound",
      "toField": "upperBound"
    },{
      "fromField": "lowerBound",
      "toField": "lowerBound"
    } ,{
      "fromField": "midBound",
      "toField": "midBound"
    } ,{
      "fromField": "boll_perc_B",
      "toField": "boll_perc_B"
    },{
      "fromField": "BB_band",
      "toField": "BB_band"
    }
  ],

    "color": "#7f8da9",
    "dataProvider": data,
//    "title": "BTC-EUR",
    "categoryField": "date",
    "stockEvents": stock_Events

  }
],

  "panels": [ {
      "title": "Value",
      "showCategoryAxis": false,
      "percentHeight": 70,
      "recalculateToPercents":"never",

      "stockGraphs": [
      {
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
        "precision":2,
        "valueField": "midBound"
      },{
        "id": "g3",
        "bullet": "round",
        "bulletBorderAlpha": 1,
        "bulletColor": "#00FF00",
        "bulletSize": 5,
        "hideBulletsCount": 50,
        "lineThickness": 2,
        "title": "upperBound",
        "useLineColorForBulletBorder": true,
        "lineColor": "#426ed1",
        "precision":2,
        "valueField": "upperBound"
      },{
        "id": "g4",
        "bullet": "round",
        "bulletBorderAlpha": 1,
        "bulletColor": "#00FF00",
        "bulletSize": 5,
        "hideBulletsCount": 50,
        "lineThickness": 2,
        "title": "lowerBound",
        "useLineColorForBulletBorder": true,
        "lineColor": "#426ed1",
        "precision":2,
        "valueField": "lowerBound"
      },
      {
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
        "precision":2,
        "valueField": "upperBound"
        },
        {
          "id": "g5",
          "bullet": "round",
          "bulletBorderAlpha": 1,
          "bulletColor": "#00FF00",
          "bulletSize": 5,
          "hideBulletsCount": 50,
          "lineThickness": 2,
          "title": "open2",
          "useLineColorForBulletBorder": true,
          "lineColor": "#426ed1",
          "precision":2,
          "valueField": "open2"
        },
        {
          "id": "g1",
          "balloonText": "Open:<b>[[open]]</b><br>Low:<b>[[low]]</b><br>High:<b>[[high]]</b><br>Close:<b>[[close]]</b><br>",
          "closeField": "close",
          "fillColors": "#3fd217",
          "highField": "high",
          "lineColor": "#000000",
          "lineAlpha": 1,
          "lowField": "low",
          "fillAlphas": 0.9,
          "negativeFillColors": "#ff0000",
          "negativeLineColor": "#000000",
          "openField": "open",
          "precision":2,
          "title": "Price:",
          "type": "candlestick",

        }
      ],

      "stockLegend": {

        "valueTextRegular": "[[value]]",
        "valueWidth": 140

      //   "periodValueTextComparing": "[[percents.value.close]]%"
      }
    },

    {
      "title": "Volume",
      "percentHeight": 30,
      "marginTop": 1,
      "showCategoryAxis": true,
      "valueAxes": [ {
        "dashLength": 5
      } ],

      "categoryAxis": {
        "dashLength": 5
      },

      "stockGraphs": [ {
        "valueField": "volume",
        "type": "column",
        "showBalloon": false,
        "fillAlphas": 1
      } ],

      "stockLegend": {
        "markerType": "none",
        "markerSize": 0,
        "labelText": "",
        "periodValueTextRegular": "[[value.close]]"
      }
    }
  ],

  "chartScrollbarSettings": {
    "graph": "g1",
    "graphType": "line",
    "usePeriod": "hh"
  },
  // "dataSetSelector": {
  //   "position": "left"
  // },
  "periodSelector": {
    "position": "top",
    "dateFormat": "YYYY-MM-DD JJ:NN",
    "inputFieldWidth": 150,
    "periods": [{
      "period": "mm",
      "count": 15,
      "label": "15 min"
    }, {
      "period": "hh",
      "count": 1,
      "label": "1 hour"

    }, {
      "period": "hh",
      "count": 2,
      "label": "2 hours"
    }, {
      "period": "hh",
      "count": 5,
      "label": "5 hour"
    }, {
      "period": "hh",
      "count": 12,
      "label": "12 hours"
    }, {
      "period": "hh",
      "count": 24,
      "label": "24 hours",
      "selected": true
    }, {
      "period": "MAX",
      "label": "MAX"
    } ]
  }
} );

chart.addListener("zoomed", handleZoom);

function handleZoom(e) {
  // activeRange = {
  //   startDate: e.startDate,
  //   endDate: e.endDate,
  //   period: e.period
  // };

//  console.log('new activeRange', activeRange);
console.log(e.period)
  if (e.period === "15mm"){
    var chart = AmCharts.charts[ 0 ];
    chart.panels[0].graphs[1].hidden=false
    chart.panels[0].graphs[2].hidden=false
    chart.panels[0].graphs[3].hidden=false
    chart.panels[0].graphs[4].hidden=false
    chart.panels[0].graphs[5].hidden=false

  }else{
    var chart = AmCharts.charts[ 0 ];

    chart.panels[0].graphs[1].hidden=true
    chart.panels[0].graphs[2].hidden=true
    chart.panels[0].graphs[3].hidden=true
    chart.panels[0].graphs[4].hidden=true
    chart.panels[0].graphs[5].hidden=true
  };
    chart.validateNow(true, true);
}



// Themes begin
am4core.useTheme(am4themes_animated);
// Themes end

// Create chart instance
var chart = am4core.create("chartdiv2", am4charts.XYChart);

// Add data
//chart.data = data;



// Create axes
var dateAxis = chart.xAxes.push(new am4charts.DateAxis());
var valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

// Create series
var series = chart.series.push(new am4charts.LineSeries());
series.dataFields.valueY = "close_norm";
series.dataFields.dateX = "date";
series.tooltipText = "{value}"
series.strokeWidth = 2;
series.minBulletDistance = 15;
series.data = data;
series.name = "Buy & Hold";


// Drop-shaped tooltips
series.tooltip.background.cornerRadius = 20;
series.tooltip.background.strokeOpacity = 0;
series.tooltip.pointerOrientation = "vertical";
series.tooltip.label.minWidth = 40;
series.tooltip.label.minHeight = 40;
series.tooltip.label.textAlign = "middle";
series.tooltip.label.textValign = "middle";

// Make bullets grow on hover
var bullet = series.bullets.push(new am4charts.CircleBullet());
bullet.circle.strokeWidth = 2;
bullet.circle.radius = 4;
bullet.circle.fill = am4core.color("#fff");

var bullethover = bullet.states.create("hover");
bullethover.properties.scale = 1.3;

// Make a panning cursor
chart.cursor = new am4charts.XYCursor();
chart.cursor.behavior = "panXY";
chart.cursor.xAxis = dateAxis;
chart.cursor.snapToSeries = series;


// Create series
var series2 = chart.series.push(new am4charts.LineSeries());
series2.dataFields.valueY = "value";
series2.dataFields.dateX = "date";
series2.tooltipText = "{value}"
series2.strokeWidth = 2;
series2.minBulletDistance = 15;
series2.data = graph_realcapital;
series2.name = "Strategy";

// Create vertical scrollbar and place it before the value axis
chart.scrollbarY = new am4core.Scrollbar();
chart.scrollbarY.parent = chart.leftAxesContainer;
chart.scrollbarY.toBack();

// Create a horizontal scrollbar with previe and place it underneath the date axis
chart.scrollbarX = new am4charts.XYChartScrollbar();
chart.scrollbarX.series.push(series);
chart.scrollbarX.parent = chart.bottomAxesContainer;

chart.events.on("ready", function () {
  // dateAxis.zoom({start:0.79, end:1});


  // Add legend
  chart.legend = new am4charts.Legend();
  chart.legend.position = "top";


  chart.dateFormatter.dateFormat = "d MMM, yyyy";
});



// Themes begin
am4core.useTheme(am4themes_animated);
// Themes end

// Create chart instance
var chart = am4core.create("chartdiv3", am4charts.XYChart);

// Add data
chart.data = graph_quantum;

// Use only absolute numbers
//chart.numberFormatter.numberFormat = "#.#s";

// Create axes
var categoryAxis = chart.yAxes.push(new am4charts.CategoryAxis());
categoryAxis.dataFields.category = "id";
categoryAxis.renderer.grid.template.location = 0;
categoryAxis.renderer.inversed = true;

var valueAxis = chart.xAxes.push(new am4charts.ValueAxis());
valueAxis.extraMin = 0.1;
valueAxis.extraMax = 0.1;
valueAxis.renderer.minGridDistance = 40;
valueAxis.renderer.ticks.template.length = 5;
valueAxis.renderer.ticks.template.disabled = false;
valueAxis.renderer.ticks.template.strokeOpacity = 0.4;



var win = chart.series.push(new am4charts.ColumnSeries());
win.dataFields.valueX = "profit";
win.dataFields.categoryY = "id";
win.clustered = false;

var winLabel = win.bullets.push(new am4charts.LabelBullet());
winLabel.label.text = "{valueX}";
winLabel.label.hideOversized = false;
winLabel.label.truncate = false;
winLabel.label.horizontalCenter = "left";
winLabel.label.dx = 10;


}

function addPanel(a) {
  var chart = AmCharts.charts[ 0 ];
  //if ( chart.panels.length == 1 && a ==="Volume" ) {
  if ( a ==="Volume" ) {
    var newPanel = new AmCharts.StockPanel();
    newPanel.allowTurningOff = true;
    newPanel.title = "Volume";
    newPanel.showCategoryAxis = true;


    newPanel.percentHeight = 30;
    newPanel.marginTop = 1;


    var graph = new AmCharts.StockGraph();
    graph.valueField = "volume";
    graph.type= "column";
    graph.fillAlphas = 0.5;
    newPanel.addStockGraph( graph );

    var legend = new AmCharts.StockLegend();
    legend.markerType = "none";
    legend.markerSize = 0;
    legend.periodValueTextRegular = "[[value.close]]"
    newPanel.stockLegend = legend;


  }
  if ( a ==="%B" ) {
    var newPanel = new AmCharts.StockPanel();
    newPanel.allowTurningOff = true;
    newPanel.title = "%B";
    newPanel.showCategoryAxis = true;


    newPanel.percentHeight = 40;
    newPanel.marginTop = 1;


    var graph = new AmCharts.StockGraph();
    graph.valueField = "boll_perc_B";
    //graph.type= "column";
    graph.fillAlphas = 0.5;
    newPanel.addStockGraph( graph );

    var legend = new AmCharts.StockLegend();
    legend.markerType = "none";
    legend.markerSize = 0;
    legend.periodValueTextRegular = "[[value.close]]"
    newPanel.stockLegend = legend;



  }
  if ( a ==="BBBand" ) {
    var newPanel = new AmCharts.StockPanel();
    newPanel.allowTurningOff = true;
    newPanel.title = "BB Bandwith";
    newPanel.showCategoryAxis = true;


    newPanel.percentHeight = 40;
    newPanel.marginTop = 1;


    var graph = new AmCharts.StockGraph();
    graph.valueField = "BB_band";
    //graph.type= "column";
    graph.fillAlphas = 0.5;
    newPanel.addStockGraph( graph );

    var legend = new AmCharts.StockLegend();
    legend.markerType = "none";
    legend.markerSize = 0;
    legend.periodValueTextRegular = "[[value.close]]"
    newPanel.stockLegend = legend;




  }
  chart.addPanelAt( newPanel,1);
  chart.validateNow();
}

// function removePanel() {
//   var chart = AmCharts.charts[ 0 ];
//   if ( chart.panels.length > 1 ) {
//     chart.removePanel( chart.panels[ 1 ] );
//     chart.validateNow();
//   }
// }

var trade_closed = [
	  { "name": "Parvez Ansari", "email": "ansariparvez@gmai.com", "mobile":"9998979695" },
	  { "name": "Tayyeb Shaikh", "email": "tshaikh1981@gmai.com", "mobile":"9091929394" },
	  { "name": "Ashfaque Shaikh", "email": "ashly786@gmai.com", "mobile":"8081828384" }
	];

function generateDynamicTable(){
    console.log(trade_closed)
		var noOftrade_closed = trade_closed.length;

		if(noOftrade_closed>0){



			// CREATE DYNAMIC TABLE.
			var table = document.createElement("table");
			table.style.width = '50%';
			table.setAttribute('border', '1');
			table.setAttribute('cellspacing', '0');
			table.setAttribute('cellpadding', '5');

			// retrieve column header ('Name', 'Email', and 'Mobile')

			var col = []; // define an empty array
			for (var i = 0; i < noOftrade_closed; i++) {
				for (var key in trade_closed[i]) {
					if (col.indexOf(key) === -1) {
						col.push(key);
					}
				}
			}

			// CREATE TABLE HEAD .
			var tHead = document.createElement("thead");


			// CREATE ROW FOR TABLE HEAD .
			var hRow = document.createElement("tr");

			// ADD COLUMN HEADER TO ROW OF TABLE HEAD.
			for (var i = 0; i < col.length; i++) {
					var th = document.createElement("th");
					th.innerHTML = col[i];
					hRow.appendChild(th);
			}
			tHead.appendChild(hRow);
			table.appendChild(tHead);

			// CREATE TABLE BODY .
			var tBody = document.createElement("tbody");

			// ADD COLUMN HEADER TO ROW OF TABLE HEAD.
			for (var i = 0; i < noOftrade_closed; i++) {

					var bRow = document.createElement("tr"); // CREATE ROW FOR EACH RECORD .


					for (var j = 0; j < col.length; j++) {
						var td = document.createElement("td");
						td.innerHTML = trade_closed[i][col[j]];
						bRow.appendChild(td);
					}
					tBody.appendChild(bRow)

			}
			table.appendChild(tBody);


			// FINALLY ADD THE NEWLY CREATED TABLE WITH JSON DATA TO A CONTAINER.
			var divContainer = document.getElementById("trade_closed");
			divContainer.innerHTML = "";
			divContainer.appendChild(table);

		}
	}

  </script>
  <script>
{{code}}
//withData(data, trades, options)
  </script>

  <!-- call getMatrix function On body onload event to get result -->
  <body onload="withData(data, trades, options)">
  	<header>
  		<div class="grid">
  			<h1>
  				Roundtrips
  				<small>Quantum performances</small>
  			</h1>
  		</div>
  	</header>
  	<section class="body">

  		<div class="grid tCenter">
  			<!-- Div element to display result -->
  				<div id="trade_closed">
  					<p>You have no quantum trades</p>
  				</div>
  		</div>
  	</section>
  	<footer>
  		<div class="grid">
  		<p>
  			Quantum Trade
  		</p>
  		</div>
  	</footer>





  <!-- <pre><code>{{output}}</code></pre> -->
</body>
</html>
