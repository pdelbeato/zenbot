var tb = require('timebucket')
  , minimist = require('minimist')
  , n = require('numbro')
  , fs = require('fs')
  , path = require('path')
  , moment = require('moment')
  , colors = require('colors')
  , objectifySelector = require('../lib/objectify-selector')
  , engineFactory = require('../lib/quantum-engine')
  //, collectionService = require('../lib/services/collection-service')
  //, _ = require('lodash')
  //, debug = require('../lib/debug')
  , quantumTools = require('../lib/quantum-tools')
//, async = require('async')

module.exports = function (program, conf) {
  program
    .command('quantum-sim [selector]')
    .allowUnknownOption()
    .description('run a simulation on backfilled data with Quantum feature')
    .option('--conf <path>', 'path to optional conf overrides file')
    .option('--strategy <name>', 'strategy to use', String, conf.strategy)
    .option('--order_type <type>', 'order type to use (maker/taker)', /^(maker|taker)$/i, conf.order_type)
    .option('--filename <filename>', 'filename for the result output (ex: result.html). "none" to disable', String, conf.filename)
    .option('--start <datetime>', 'start ("YYYYMMDDhhmm")')
    .option('--end <datetime>', 'end ("YYYYMMDDhhmm")')
    .option('--days <days>', 'set duration by day count', Number, conf.days)
    .option('--currency_capital <amount>', 'amount of start capital in currency', Number, conf.currency_capital)
    .option('--asset_capital <amount>', 'amount of start capital in asset', Number, conf.asset_capital)
    .option('--avg_slippage_pct <pct>', 'avg. amount of slippage to apply to trades', Number, conf.avg_slippage_pct)
  // .option('--buy_pct <pct>', 'buy with this % of currency balance', Number, conf.buy_pct)
  // .option('--sell_pct <pct>', 'sell with this % of asset balance', Number, conf.sell_pct)
    .option('--quantum_size <amount>', 'buy up to this amount of currency every time', Number, conf.quantum_size)
    .option('--max_nr_quantum <amount>', 'Max nr of quantum which could be traded', Number, conf.max_nr_quantum)
    .option('--best_bid', 'mark up as little as possible the buy price to be the best bid', Boolean, false)
    .option('--best_ask', 'mark down as little as possible the sell price to be the best ask', Boolean, false)
    .option('--dump_watchdog', 'check for dumps. Strategy is in charge', Boolean, false)
    .option('--pump_watchdog', 'check for pumps. Strategy is in charge', Boolean, false)
    .option('--buy_calmdown <amount>', 'Minutes to wait before next buy', Number, conf.buy_calmdown)
    .option('--sell_calmdown <amount>', 'Minutes to wait before next sell', Number, conf.sell_calmdown)
    .option('--markdown_buy_pct <pct>', '% to mark down buy price', Number, conf.markdown_buy_pct)
    .option('--markup_sell_pct <pct>', '% to mark up sell price', Number, conf.markup_sell_pct)
    .option('--order_adjust_time <ms>', 'adjust bid/ask on this interval to keep orders competitive', Number, conf.order_adjust_time)
    .option('--order_poll_time <ms>', 'poll order status on this interval', Number, conf.order_poll_time)
    .option('--sell_stop_pct <pct>', 'sell if price drops below this % of bought price', Number, conf.sell_stop_pct)
  // .option('--buy_stop_pct <pct>', 'buy if price surges above this % of sold price', Number, conf.buy_stop_pct)
    .option('--profit_stop_enable_pct <pct>', 'enable trailing sell stop when reaching this % profit', Number, conf.profit_stop_enable_pct)
    .option('--profit_stop_pct <pct>', 'maintain a trailing stop this % below the high-water mark of profit', Number, conf.profit_stop_pct)
    .option('--max_sell_loss_pct <pct>', 'avoid selling at a loss pct under this float (could be used for min profit)', conf.max_sell_loss_pct)
  // .option('--max_buy_loss_pct <pct>', 'avoid buying at a loss pct over this float', conf.max_buy_loss_pct)
    .option('--max_slippage_pct <pct>', 'avoid selling at a slippage pct above this float', conf.max_slippage_pct)
    .option('--symmetrical', 'reverse time at the end of the graph, normalizing buy/hold to 0', conf.symmetrical)
    .option('--rsi_periods <periods>', 'number of periods to calculate RSI at', Number, conf.rsi_periods)
    .option('--exact_buy_orders', 'instead of only adjusting maker buy when the price goes up, adjust it if price has changed at all')
    .option('--exact_sell_orders', 'instead of only adjusting maker sell when the price goes down, adjust it if price has changed at all')
    .option('--disable_options', 'disable printing of options')
    .option('--enable_stats', 'enable printing order stats')
    .option('--backtester_generation <generation>', 'creates a json file in simulations with the generation number', Number, -1)
    .option('--verbose', 'print status lines on every period')
    .option('--silent', 'only output on completion (can speed up sim)')
    .option('--debug', 'output detailed debug info')
    .action(function (selector, cmd) {
      //Con le righe seguenti, dovrei mettere in s.options tutte le opzioni passate da riga di comando, niente di più.
      var raw_opts = minimist(process.argv)
      var s = { options: JSON.parse(JSON.stringify(raw_opts)) }
      var so = s.options

      var data_array =  {}

      s.positions = []
      //		s.closed_positions = []
      s.my_trades = []
      //		s.trades = []
      s.lookback = []
      s.orders = []

      //Carico le funzioni di utilità
      quantumTools(s, conf)

      var engine = null

      //Dovrebbe cancellare tutte le opzioni passate a riga di comando senza denominazione
      // (minimist mette queste opzioni dentro un array chiamato _)
      delete so._

      //Prendo il file puntato da --conf e registro tutte le opzioni in esso contenute dentro so.
      // cmd.conf dovrebbe essere il file passato con --conf
      if (cmd.conf) {
        var overrides = require(path.resolve(process.cwd(), cmd.conf))
        Object.keys(overrides).forEach(function (k) {
          //console.log('overrides k=' + k + ' - ' + overrides[k])
          so[k] = overrides[k]
        })
      }

      // Registra in s.options tutte le opzioni passate a riga di comando, sovrascrivendo conf (ovvero le opzioni passate a quantum-trade da zenbot.js
      //   durante la chiamata, quindi zenbot.conf, ovvero l'unione delle opzioni del conf_file, conf.js e conf-sample.js)
      Object.keys(conf).forEach(function (k) {
        if (typeof cmd[k] !== 'undefined') {
          //console.log('cmd k=' + k + ' - ' + cmd[k])
          so[k] = cmd[k]
        }
      })

      //Recupera tutti i vecchi database
      //var db_my_trades = conf.db.my_trades
      //var db_my_positions = conf.db.my_positions
      s.db_my_closed_positions = conf.db.my_closed_positions
      s.db_periods = conf.db.periods
      //var db_resume_markers = conf.db.resume_markers
      var db_trades = conf.db.trades

      var eventBus = conf.eventBus

      // chiama la funzione timebucket - riporta in ms
      if (so.start) {
        so.start = moment(so.start, 'YYYYMMDDhhmm').valueOf()
        if (so.days && !so.end) {
          so.end = tb(so.start).resize('1d').add(so.days).toMilliseconds()
        }
      }
      if (so.end) {
        so.end = moment(so.end, 'YYYYMMDDhhmm').valueOf()
        if (so.days && !so.start) {
          so.start = tb(so.end).resize('1d').subtract(so.days).toMilliseconds()
        }
      }
      if (!so.start && so.days) {
        var d = tb('1d')
        so.start = d.subtract(so.days).toMilliseconds()
      }

      so.days = moment(so.end).diff(moment(so.start), 'days')

      // s.flag_up=false
      // s.flag_down=false

      so.stats = !!cmd.enable_stats
      so.show_options = !cmd.disable_options
      so.verbose = !!cmd.verbose
      so.selector = objectifySelector(selector || conf.selector)
      so.mode = 'sim'

      // richiama quantum-engine
      var engine = engineFactory(s, conf)
      if (!so.min_periods) so.min_periods = 1
      var db_cursor, reversing, reverse_point
      var db_data_cursor
      var query_start = (so.start ? tb(so.start).resize(so.period_length).subtract(so.min_periods + 2).toMilliseconds() : null)
      //var query_start = 1588202900000
      so.signal = JSON.parse(fs.readFileSync('data.json'));
      console.log(so.signal[0].Date)
      var getNext = async () => {
        var opts = {
          query: {
            selector: so.selector.normalized
          },
          sort: {
            time: 1
          },
          limit: 1000,
          timeout: false
        }
        if (so.end) {
          opts.query.time = { $lte: so.end }
        }
        if (db_cursor) {
          if (reversing) {
            opts.query.time = {}
            opts.query.time['$lt'] = db_cursor
            if (query_start) {
              opts.query.time['$gte'] = query_start
            }
            opts.sort = {
              time: -1
            }
          } else {
            if (!opts.query.time) {
              opts.query.time = {}
            }
            opts.query.time['$gt'] = db_cursor
          }
        } else if (query_start) {
          if (!opts.query.time) {
            opts.query.time = {}
          }
          opts.query.time['$gte'] = query_start
        }

        var collectionCursor = db_trades
          .find(opts.query)
          .sort(opts.sort)
          .limit(opts.limit)

        var totalTrades = await collectionCursor.count(true)
        const collectionCursorStream = collectionCursor.stream()
        var numTrades = 0
        var lastTrade

        var onCollectionCursorEnd = async () => {
          if (numTrades === 0) {
            if (so.symmetrical && !reversing) {
              reversing = true
              reverse_point = db_cursor
              return getNext()
            }
            if(s.tradeProcessingQueue.length()) {
            	await s.tradeProcessingQueue.drain()
            }
            exitSim()
            return
          }
          else {
            if (reversing) {
              db_cursor = lastTrade.orig_time
            }
            else {
              db_cursor = (lastTrade ? lastTrade.time : db_cursor)
            }
          }
          collectionCursorStream.close()
          await s.tradeProcessingQueue.drain()
          return getNext()
        }

        if(totalTrades === 0) {
          onCollectionCursorEnd()
        }

        collectionCursorStream.on('data', function(trade) {
        	lastTrade = trade
        	numTrades++
        	if (so.symmetrical && reversing) {
        		trade.orig_time = trade.time
        		trade.time = reverse_point + (reverse_point - trade.time)
        	}
          
        	eventBus.emit('trade', trade)

        	if (numTrades && totalTrades && totalTrades == numTrades) {
        		onCollectionCursorEnd()
        	}
        })

        collectionCursorStream.on('error', function(err) {
          console.log('Streaming error: ' + err)
          return getNext()
        })
      }

      return getNext()


      function GetFormattedDate(unform_date) {
        var month = unform_date .getMonth()+1
        if (month < 10) {
          month="0".concat(month)}
        var day = unform_date .getDate()
        if (day < 10) {
          day="0".concat(day)}
        var year = unform_date .getFullYear()
        return year + "-" + day + "-" + month;
      }


      function exitSim() {
        if (!s.period) {
          console.error('no trades found! try running `zenbot backfill ' + so.selector.normalized + '` first')
          process.exit(1)
        }
        var option_keys = Object.keys(so)
        var output_lines = []
        option_keys.sort(function (a, b) {
          if (a < b) return -1
          return 1
        })
        var options = {}
        option_keys.forEach(function (k) {
          options[k] = so[k]
        })

        let options_output = options
        options_output.simresults = {}

        if (s.my_trades.length) {
          s.my_trades.push({
            price: s.period.close,
            size: s.balance.asset,
            type: 'sell',
            time: s.period.time
          })
        }
        //s.balance.currency = n(s.net_currency).add(n(s.period.close).multiply(s.balance.asset)).format('0.00000000')

        //s.balance.asset = 0
        //        s.lookback.unshift(s.period)
        s.db_periods.updateOne({ '_id': s.period._id }, { $set: s.period }, { multi: false, upsert: true }, function (err) {
          if (err) {
            console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ': quantum-sim - exitSim - Error saving db_periods:')
            console.error(err)
          }
        })

        //var profit = s.start_capital ? n(s.balance.currency).subtract(s.start_capital).divide(s.start_capital) : n(0)
        var tmp_capital_currency = n(s.balance.currency).add(n(s.period.close).multiply(s.balance.asset)).format('0.00')
        var tmp_capital_asset = n(s.balance.asset).add(n(s.balance.currency).divide(s.period.close)).format('0.00000000')
        //        s.start_price esiste
        //        s.start_capital_currency esiste
        //        s.start_capital_asset esiste

        //        s.asset_in_currency = n(s.balance.asset).multiply(s.lookback[s.lookback.length - 1].close).value()
        //        s.currency_in_asset = n(s.balance.currency).divide(s.lookback[s.lookback.length - 1].close).value()
        //        s.start_capital_currency = n(s.balance.currency).add(s.asset_in_currency).value()

        var profit = (s.start_capital_currency ? n(tmp_capital_currency).subtract(s.start_capital_currency).divide(s.start_capital_currency) : n(0))
        //var profit = (s.options.currency_capital ? n(tmp_capital_currency).subtract(s.options.currency_capital).divide(s.options.currency_capital) : n(0))



        output_lines.push('end balance:     capital currency: ' + n(tmp_capital_currency).format('0.00000000').yellow + '   capital asset: ' + n(tmp_capital_asset).format('0.00000000').yellow + ' (' + profit.format('0.00%') + ')')
        console.log('\nstart_capital', n(s.start_capital_currency).format('0.00000000').yellow)
        //console.log('start_price', n(s.start_price).format('0.00000000').yellow)
        //		console.log('start_price', n(s.lookback[s.lookback.length - 1].close).format('0.00000000').yellow)

        console.log('start_price', n(s.start_price).format('0.00000000').yellow)
        console.log('close_price', n(s.period.close).format('0.00000000').yellow)
        var buy_hold = (s.start_price ? n(s.period.close).multiply(n(s.start_capital_currency).divide(s.start_price)) : n(s.balance.currency))
        //console.log('buy hold', buy_hold.format('0.00000000'))
        var buy_hold_profit = (s.start_capital_currency ? n(buy_hold).subtract(s.start_capital_currency).divide(s.start_capital_currency) : n(0))

        output_lines.push('buy hold: ' + buy_hold.format('0.00000000').yellow + ' (' + n(buy_hold_profit).format('0.00%') + ')')
        output_lines.push('vs. buy hold: ' + n(s.currency_capital).subtract(buy_hold).divide(buy_hold).format('0.00%').yellow)
        output_lines.push(n(s.my_trades.length).format('0').yellow + ' trades over ' + n(s.day_count).format('0').yellow + ' days (avg ' + n(s.my_trades.length / s.day_count).format('0.00').yellow + ' trades/day)')

        var losses = 0
        var wins = 0
        //console.log(s.my_trades)
        s.my_trades.forEach(function (trade) {

          if (trade.profit > 0) {
            wins++
          } else if (trade.profit < 0) {
            losses++
          }

        })
        if (s.my_trades.length) {
          //output_lines.push('win/loss: ' + (sells - losses) + '/' + losses)
          output_lines.push('win/loss for each quantum: ' + n(wins).format('0').yellow + '/' + n(losses).format('0').yellow)
          output_lines.push('error rate: ' + (wins ? n(losses).divide(wins).format('0.00%') : '0.00%').yellow)
        }
        options_output.simresults.start_capital = s.start_capital
        options_output.simresults.last_buy_price = s.last_buy_price
        options_output.simresults.last_asset_value = s.start_price
        options_output.net_currency = s.net_currency
        options_output.simresults.asset_in_currency = s.asset_in_currency
        options_output.simresults.currency = n(s.real_capital).value()
        options_output.simresults.profit = profit.value()
        options_output.simresults.buy_hold = buy_hold.value()
        options_output.simresults.buy_hold_profit = buy_hold_profit.value()
        options_output.simresults.total_trades = s.my_trades.length
        options_output.simresults.length_days = s.day_count
        options_output.simresults.total_wins = wins
        options_output.simresults.total_losses = losses
        options_output.simresults.vs_buy_hold = n(s.real_capital).subtract(buy_hold).divide(buy_hold).value() * 100.00

        let options_json = JSON.stringify(options_output, null, 2)
        if (so.show_options) {
          output_lines.push(options_json)
        }

        for (var i = 0; i < 4; i++) {
          console.log(output_lines[i])
        }

        if (so.backtester_generation >= 0) {
          fs.writeFileSync(path.resolve(__dirname, '..', 'simulations', 'sim_' + so.strategy.replace('_', '') + '_' + so.selector.normalized.replace('_', '').toLowerCase() + '_' + so.backtester_generation + '.json'), options_json, { encoding: 'utf8' })
        }

        if (so.filename !== 'none') {
          var html_output = output_lines.map(function (line) {
            return colors.stripColors(line)
          }).join('\n')



          var opts = {
            query: {
              selector: so.selector.normalized
            },
            sort: { time: 1 },
            limit: 1000
          }
          if (so.end) {
            opts.query.time = { $lte: so.end }
          }
          if (db_data_cursor) {
            if (!opts.query.time) opts.query.time = {}
            opts.query.time['$gt'] = db_data_cursor

          }
          else if (query_start) {
            if (!opts.query.time) opts.query.time = {}
            opts.query.time['$gte'] = query_start
          }



          //          var data = s.lookback.slice(0, s.lookback.length).map(function (period) {
          var data = s.db_periods.find(opts.query).stream()
          var numdata = 0
          data.on('data', function (period) {

            //lastdata = period
            numdata++
            var data_el = {}
            var keys = Object.keys(period)
            for (var i = 0; i < keys.length; i++) {
              data_el[keys[i]] = period[keys[i]]
            }
            //return data
            data_array[numdata] = data_el

          })

          data.on('end', function () {
            // console.log(data_array)
            var result = Object.keys(data_array).map(function (key) {

              return data_array[key]
            })
            var data_chart = []; var i = 0; var data_chart_period = []

            result = result.map(function (d) {
              d.date = new Date(d.time)
              if (typeof d.strategy === 'object') {
                i++
                data_chart.push([
                  d.date,
                  d.open,
                  d.high,
                  d.low,
                  d.close,
                  d.volume
                ])

                if (d.date.getMinutes() % 15 === 0  ) {

                  data_chart_period.push ([
                    d.date,
                    d.open,
                    d.high,
                    d.low,
                    d.close,
                    d.volume

                  ]);
                  }
                Object.keys(so.chart).map(function (key) {
                  var strategy = key

                  Object.keys(so.chart[key].data).map(function (sub_key) {
                    if (typeof d.strategy[strategy] === 'object') {
                      ///// Grafica bollinger
                      if (sub_key === 'bollinger') {

                        if (typeof d.strategy[strategy].data[sub_key] === 'object') {
                          d.upperBound = d.strategy[strategy].data[sub_key].upperBound
                          d.midBound = d.strategy[strategy].data[sub_key].midBound
                          d.lowerBound = d.strategy[strategy].data[sub_key].lowerBound

                        } else {
                          d.upperBound = d.open
                          d.midBound = d.open
                          d.lowerBound = d.open
                        }
                        data_chart[i - 1].push(d.upperBound)
                        data_chart[i - 1].push(d.midBound)
                        data_chart[i - 1].push(d.lowerBound)
                      }

                      ///// Grafica stochastic K
                      if (sub_key === 'stoch') {
                        if (typeof d.strategy[strategy].data[sub_key] === 'object') {

                          data_chart[i - 1].push(d.strategy[strategy].data[sub_key].k)

                        }
                      }
                    }
                  })
                })


              }
              return d
            })


            var trades_chart_buy = []; var trades_chart_sell = [];var data_markers_buy=[];var data_markers_sell=[]
            var trades_chart_buy_period = [];var trades_chart_sell_period = []
            var coeff = 1000 * 60; var coeff1= 1000 * 60 *15;
            s.my_trades.map(function (t, index) {

              t.date = new Date(Math.round(t.time / coeff) * coeff)
              descr1="id: "
              if (t.signal === 'buy' && t.time !== null) {
                trades_chart_buy.push([
                  t.date,
                  t.price
                ])
                trades_chart_buy_period.push([
                  new Date(Math.round(t.time / coeff1) * coeff1),
                  t.price
                ])
                data_markers_buy.push({
                  "date": t.date,
                  "description":  descr1.concat(t.id,"  timestamp: ", t.time),
                  "id": t.id,
                  "value":t.price,
                  "time":t.time
                })



              }
              if (t.signal === 'sell' && t.time !== null) {
                trades_chart_sell.push([
                  t.date,
                  t.price
                ])
                trades_chart_sell_period.push([
                  new Date(Math.round(t.time / coeff1) * coeff1),
                  t.price
                ])
                data_markers_sell.push({
                  "date": t.date,
                  "description":  descr1.concat(t.id," timestamp: ", t.time),
                  "id": t.id,
                  "value":t.price,
                  "time":t.time
                })
              }

            })





            var trade_segment = []
            data_markers_buy.map(function (t) {
              var id_match=data_markers_sell.find(x => x.id === t.id)
              if (typeof id_match!== 'undefined'){
                console.log(id_match)
                trade_segment.push({
                  xAnchor: GetFormattedDate(new Date(t.time)),
                  valueAnchor: t.value,
                  secondXAnchor: GetFormattedDate(new Date(id_match.time)),
                  secondValueAnchor: id_match.match

                })
              }

            })
            console.log(trade_segment)
            var code = 'var data = ' + JSON.stringify(data_chart) + ';\n'
            code += 'var trades_chart_buy = ' + JSON.stringify(trades_chart_buy) + ';\n'
            code += 'var trades_chart_sell = ' + JSON.stringify(trades_chart_sell) + ';\n'
            code += 'var data_markers_buy = ' + JSON.stringify(data_markers_buy) + ';\n'
            code += 'var data_markers_sell = ' + JSON.stringify(data_markers_sell) + ';\n'
            code += 'var options = ' + JSON.stringify(s.options) + ';\n'
            // console.log(code)
            var tpl = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'anychart4.html.tpl'), { encoding: 'utf8' })


            var out = tpl
              .replace('{{code}}', code)
              .replace('{{trend_ema_period}}', so.trend_ema || 36)
              .replace('{{output}}', html_output)
              .replace(/\{\{symbol\}\}/g, so.selector.normalized + ' - zenbot ' + require('../package.json').version)

            var out_target = so.filename || 'simulations/sim_result_' + so.selector.normalized + '_' + new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/-/g, '').replace(/:/g, '').replace(/20/, '') + '_UTC.html'
            fs.writeFileSync(out_target, out)
            console.log('wrote', out_target)

            //simulation in Strategy periods
            var code = 'var data = ' + JSON.stringify(data_chart_period) + ';\n'
            code += 'var trades_chart_buy_period = ' + JSON.stringify(trades_chart_buy_period) + ';\n'
            code += 'var trades_chart_sell_period = ' + JSON.stringify(trades_chart_sell_period) + ';\n'
            code += 'var data_markers_buy = ' + JSON.stringify(data_markers_buy) + ';\n'
            code += 'var data_markers_sell = ' + JSON.stringify(data_markers_sell) + ';\n'
            code += 'var options = ' + JSON.stringify(s.options) + ';\n'
            var tpl2 = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'anychart_Str_period.html.tpl'), { encoding: 'utf8' })

            var json = JSON.stringify(data_chart_period)



            var out = tpl2
              .replace('{{code}}', code)
              .replace('{{trend_ema_period}}', so.trend_ema || 36)
              .replace('{{output}}', html_output)
              .replace(/\{\{symbol\}\}/g, so.selector.normalized + ' - zenbot ' + require('../package.json').version)

            var out_target = so.filename || 'simulations/sim_result_Strategy_period' + so.selector.normalized + '_' + new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/-/g, '').replace(/:/g, '').replace(/20/, '') + '_UTC.html'
            fs.writeFileSync(out_target, out)
            fs.writeFileSync("./simulations/indicator_testing/data/data.json", json)
            console.log('wrote', out_target)


            db_data_cursor = data.time
          })
        }
      }
    })
}
