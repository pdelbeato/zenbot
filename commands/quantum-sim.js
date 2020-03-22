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
  , _ = require('lodash')
  , debug = require('../lib/debug')
  , quantumTools = require ('../lib/quantum-tools')
//  , async = require('async')

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
    .option('--backtester_generation <generation>','creates a json file in simulations with the generation number', Number, -1)
    .option('--verbose', 'print status lines on every period')
    .option('--silent', 'only output on completion (can speed up sim)')
    .action(function (selector, cmd) {
      var s = { options: minimist(process.argv) }
      // copia su so le opzioni messe a comando
      var so = s.options
      s.positions = []
  //		s.closed_positions = []
  		s.my_trades = []
  //		s.trades = []
  		s.lookback = []
  		s.orders = []

      //Carico le funzioni di utilità
      quantumTools(s, conf)

      delete so._
      // se viene passato file di conf sovrascrive le opzioni
      if (cmd.conf) {
        var overrides = require(path.resolve(process.cwd(), cmd.conf))
        Object.keys(overrides).forEach(function (k) {
          so[k] = overrides[k]
        })
      }
      Object.keys(conf).forEach(function (k) {
        if (!_.isUndefined(cmd[k])) {
          so[k] = cmd[k]
        }
      })
      //  restituisce Collection di mongodb - trades e simResults
      //var tradesCollection = collectionService(conf).getTrades()
      var db_trades = conf.db.trades

      //var simResults = collectionService(conf).getSimResults()
      var simResults = conf.db.simResults
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
      var cursor, reversing, reverse_point
      var query_start = (so.start ? tb(so.start).resize(so.period_length).subtract(so.min_periods + 2).toMilliseconds() : null)

      function exitSim () {
        console.log('exittttt')
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
        s.lookback.unshift(s.period)
        //var profit = s.start_capital ? n(s.balance.currency).subtract(s.start_capital).divide(s.start_capital) : n(0)


        var tmp_capital_currency = n(s.balance.currency).add(n(s.period.close).multiply(s.balance.asset)).format('0.00')
        var tmp_capital_asset = n(s.balance.asset).add(n(s.balance.currency).divide(s.period.close)).format('0.00000000')


        var profit = s.start_capital_currency ? n(tmp_capital_currency).subtract(s.start_capital_currency).divide(s.start_capital_currency) : n(0)

        output_lines.push('end balance:     capital currency: ' + n(tmp_capital_currency).format('0.00000000').yellow + '   capital asset: ' + n(tmp_capital_asset).format('0.00000000').yellow + ' (' + profit.format('0.00%') + ')')
        console.log('\nstart_capital', n(s.start_capital_currency).format('0.00000000').yellow)
        console.log('start_price', n(s.start_price).format('0.00000000').yellow)
        console.log('close', n(s.period.close).format('0.00000000').yellow)
        var buy_hold = s.start_price ? n(s.period.close).multiply(n(s.start_capital_currency).divide(s.start_price)) : n(s.balance.currency)
        //console.log('buy hold', buy_hold.format('0.00000000'))
        var buy_hold_profit = s.start_capital_currency ? n(buy_hold).subtract(s.start_capital_currency).divide(s.start_capital_currency) : n(0)

        output_lines.push('buy hold: ' + buy_hold.format('0.00000000').yellow + ' (' + n(buy_hold_profit).format('0.00%') + ')')
        output_lines.push('vs. buy hold: ' + n(s.currency_capital).subtract(buy_hold).divide(buy_hold).format('0.00%').yellow)
        output_lines.push(n(s.my_trades.length).format('0').yellow + ' trades over ' + n(s.day_count).format('0').yellow + ' days (avg ' + n(s.my_trades.length / s.day_count).format('0.00').yellow + ' trades/day)')


        var losses = 0
        var wins = 0
        //console.log(s.my_trades)
        s.my_trades.forEach(function (trade) {

          if (trade.profit > 0) {
            wins++
          } else if (trade.profit < 0){
            losses++
          }


        })
        if (s.my_trades.length) {
          //output_lines.push('win/loss: ' + (sells - losses) + '/' + losses)
          output_lines.push('win/loss for each quantum: ' + n(wins).format('0').yellow + '/' + n(losses).format('0').yellow )
          output_lines.push('error rate: ' + (wins ? n(losses).divide(wins).format('0.00%') : '0.00%').yellow)
        }
        options_output.simresults.start_capital = s.start_capital
        options_output.simresults.last_buy_price = s.last_buy_price
        options_output.simresults.last_assest_value = s.trades[s.trades.length-1].price
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


        for (var i = 0; i < 6; i++) {
          console.log(output_lines[i])
        }

        if (so.backtester_generation >= 0)
        {
          fs.writeFileSync(path.resolve(__dirname, '..', 'simulations','sim_'+so.strategy.replace('_','')+'_'+ so.selector.normalized.replace('_','').toLowerCase()+'_'+so.backtester_generation+'.json'),options_json, {encoding: 'utf8'})
        }

        if (so.filename !== 'none') {

          var html_output = output_lines.map(function (line) {
            return colors.stripColors(line)
          }).join('\n')


          var data =s.lookback.slice(0, s.lookback.length).map(function (period) {

          //var data = so.strategy.bollinger.calc_lookback.slice(0, so.strategy.bollinger.calc_lookback.length ).map(function (period) {
          //var data = s.calc_lookback.slice(0, s.calc_lookback.length ).map(function (period) {
          // var data = s.calc_lookback.map(function (period) {
            var data = {}
            var keys = Object.keys(period)
            for(var i = 0;i < keys.length;i++){
              data[keys[i]] = period[keys[i]]
            }
            return data
          })


          var code = 'var data = ' + JSON.stringify(data) + ';\n'
          code += 'var trades = ' + JSON.stringify(s.my_trades) + ';\n'

          code += 'var options = ' + JSON.stringify(s.options) + ';\n'
          // console.log(code)
          var tpl = fs.readFileSync(path.resolve(__dirname, '..', 'templates', '13sim_result.html.tpl'), {encoding: 'utf8'})


          var out = tpl

            .replace('{{code}}', code)
            .replace('{{trend_ema_period}}', so.trend_ema || 36)
            .replace('{{output}}', html_output)
            .replace(/\{\{symbol\}\}/g,  so.selector.normalized + ' - zenbot ' + require('../package.json').version)

          var out_target = so.filename || 'simulations/sim_result_' + so.selector.normalized +'_' + new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/-/g, '').replace(/:/g, '').replace(/20/, '') + '_UTC.html'
          fs.writeFileSync(out_target, out)
          console.log('wrote', out_target)
        }

        //Corretto per Deprecation Warning
        simResults.insertOne(options_output)
          .then(() => {
            process.exit(0)
          })
          .catch((err) => {
            console.error(err)
            process.exit(0)
          })
      }

      function getNext () {
//        console.log('getNexttt')
        var opts = {
          query: {
            selector: so.selector.normalized
          },
          sort: {time: 1},
          limit: 1000
        }
        if (so.end) {
          opts.query.time = {$lte: so.end}
        }
        if (cursor) {
          if (reversing) {
            opts.query.time = {}
            opts.query.time['$lt'] = cursor
            if (query_start) {
              opts.query.time['$gte'] = query_start
            }
            opts.sort = {time: -1}
          }
          else {
            if (!opts.query.time) opts.query.time = {}
            opts.query.time['$gt'] = cursor
          }
        }
        else if (query_start) {
          if (!opts.query.time) opts.query.time = {}
          opts.query.time['$gte'] = query_start
        }
        var numTrades = 0
        var lastTrade


        //riordino di tradeCollection
        var collectionCursor = db_trades.find(opts.query).sort(opts.sort).toArray((err, db_trades_docs) => {

              db_trades_docs.forEach(function (trade, index) {
                  lastTrade = trade
                  numTrades++
                    if (so.symmetrical && reversing) {
                      trade.orig_time = trade.time
                      trade.time = reverse_point + (reverse_point - trade.time)
                    }
                  // emit per ogni trade -> va alla funzione   queueTrade che mette in coda il tradeProcessing e quindi onTrade
                  //eventBus.emit('trade', trade)
                  let emit_promise = new Promise(function(resolve, reject) {
                    if (err) {
                      reject(err)
                    } else {
                        eventBus.emit('trade', trade)
                        console.log(numTrades)
                        resolve();
                      }

                    });
                    emit_promise.then(function() {
                      // if(numTrades === db_trades_docs.length){
                      //   console.log(db_trades_docs.length)
                      //
                      //
                      //   if (so.symmetrical && !reversing) {
                      //     reversing = true
                      //     reverse_point = cursor
                      //     return getNext()
                      //   }
                      //   console.log('exit______________')
                      //   engine.exit(exitSim)
                      //   return
                      // } else {
                      //   if (reversing) {
                      //     cursor = lastTrade.orig_time
                      //   }
                      //   else {
                      //     cursor = lastTrade.time
                      //   }
                      // }
                      // setImmediate(getNext)

                    })



                  }
                );



              });//.stream()



        //
        // collectionCursor.on('data', function(trade){
        //
        //   lastTrade = trade
        //   numTrades++
        //   //console.log(numTrades)
        //   if (so.symmetrical && reversing) {
        //     trade.orig_time = trade.time
        //     trade.time = reverse_point + (reverse_point - trade.time)
        //   }
        //
        //   // emit per ogni trade -> va alla funzione   queueTrade che mette in coda il tradeProcessing e quindi onTrade
        //   eventBus.emit('trade', trade)
        //   if (!s.orig_currency) {
        //
        //     s.orig_currency = s.start_currency = so.currency_capital | s.balance.currency | 0
        //     s.orig_asset = s.start_asset = so.asset_capital | s.balance.asset | 0
        //     engine.syncBalance(function () {
        //       s.orig_price = s.start_price
        //       s.orig_capital_currency = s.orig_currency + (s.orig_asset * s.orig_price)
        //       s.orig_capital_asset = s.orig_asset + (s.orig_currency / s.orig_price)
        //       debug.msg('s.orig_currency= ' + s.orig_currency + ' ; s.orig_capital_currency= ' + s.orig_capital_currency)
        //     })
        //   }
        // })

        // collectionCursor.on('end', function(){
        //
        //   // se numTrades === 0 chiama engine.exit(exitSim) - se presente esegue onExit della strategia e poi exit di quantum-sim
        //   if(numTrades === 0){
        //     if (so.symmetrical && !reversing) {
        //       reversing = true
        //       reverse_point = cursor
        //       return getNext()
        //     }
        //     engine.exit(exitSim)
        //     return
        //   } else {
        //     if (reversing) {
        //       cursor = lastTrade.orig_time
        //     }
        //     else {
        //       cursor = lastTrade.time
        //     }
        //   }
        //   setImmediate(getNext)
        //
        // })

      }

      getNext()
    })
}
