let tb = require('timebucket')
  , moment = require('moment')
  , z = require('zero-fill')
  , n = require('numbro')
  , crypto = require('crypto')
  // eslint-disable-next-line no-unused-vars
  , colors = require('colors')
  , abbreviate = require('number-abbreviate')
  , readline = require('readline')
  , path = require('path')
  , _ = require('lodash')
  , notify = require('./notify')
  , rsi = require('./rsi')
  , async = require('async')
  , lolex = require('lolex')
  , { formatAsset, formatPercent, formatCurrency } = require('./format')
  , debug = require('./debug')
// , collectionService = require('../lib/services/collection-service')

let clock
let nice_errors = new RegExp(/(slippage protection|ProfitLoss protection|max quantum reached|pumpdump watchdog|BuySell calmdown|Price limit protection)/)
let position_max_profit_index
let working_position_index

module.exports = function (s, conf) {
  let eventBus = conf.eventBus
  eventBus.on('trade', queueTrade)
  eventBus.on('trades', onTrades)

  let so = s.options

  //Assegna l'exchange tra live, sim o paper
  if(_.isUndefined(s.exchange)){
    if (so.mode !== 'live') {
      s.exchange = require(path.resolve(__dirname, '../extensions/exchanges/sim/exchange'))(conf, s)
    }
    else {
      s.exchange = require(path.resolve(__dirname, `../extensions/exchanges/${so.selector.exchange_id}/exchange`))(conf)
    }
  }
  else if (so.mode === 'paper') {
    s.exchange = require(path.resolve(__dirname, '../extensions/exchanges/sim/exchange'))(conf, s)
  }
  if (!s.exchange) {
    console.error('cannot trade ' + so.selector.normalized + ': exchange not implemented')
    process.exit(1)
  }

  s.product_id = so.selector.product_id
  s.asset = so.selector.asset
  s.currency = so.selector.currency
  s.asset_capital = 0
  s.is_dump_watchdog = false
  s.is_pump_watchdog = false

  //Per la compatibilità tra le opzioni period e period_length
  if (typeof so.period_length == 'undefined')
    so.period_length = so.period
  else
    so.period = so.period_length

  //Assegno il giusto product tra quelli a disposizione dell'exchange
  let products = s.exchange.getProducts()
  products.forEach(function (product) {
    if (product.asset === s.asset && product.currency === s.currency) {
      s.product = product
    }
  })
  if (!s.product) {
    console.error('error: could not find product "' + s.product_id + '"')
    process.exit(1)
  }
  if (s.exchange.dynamicFees) {
    s.exchange.setFees({asset: s.asset, currency: s.currency})
  }
  if (so.mode === 'sim' || so.mode === 'paper') {
    s.balance = {asset: so.asset_capital, currency: so.currency_capital, deposit: 0}
  }
  else {
    s.balance = {asset: 0, currency: 0, deposit: 0}
  }

  //Funzione per la stampa a schermo di tutti i dati del programma, esclusi i dati storici e quelli di MongoDB
  function memDump () {
    if (!debug.on) return
    let s_copy = JSON.parse(JSON.stringify(s))
    delete s_copy.options.mongo
    delete s_copy.lookback
    delete s_copy.calc_lookback
    console.error(s_copy)
  }

  //Funzione per assegnare alle opzioni i valori di default qualora non avessero valori
  s.ctx = {
    option: function (name, desc, type, def) {
      if (typeof so[name] === 'undefined') {
        so[name] = def
      }
    }
  }

  let asset_col_width = 0
  let deposit_col_width = 0
  let currency_col_width = 0
  s.lookback = []
  s.calc_lookback = []
  s.day_count = 1
  s.my_trades = []
  s.my_positions = []
  s.my_prev_trades = []
  s.vol_since_last_blink = 0
  if (conf.output.api.on) {
    s.boot_time = (new Date).getTime()
    s.tz_offset = new Date().getTimezoneOffset()
    s.last_trade_id = 0
    s.trades = []
  }
  if (so.strategy) {
    s.strategy = require(path.resolve(__dirname, `../extensions/strategies/${so.strategy}/strategy`))
    if (s.strategy.getOptions) {
      s.strategy.getOptions.call(s.ctx, s)
    }
    if (s.strategy.orderExecuted) {
      eventBus.on('orderExecuted', function(type) {
        s.strategy.orderExecuted(s, type, executeSignal)
      })
    }
  }

  var notifier = notify(conf)

  function pushMessage(title, message) {
    if (so.mode === 'live' || so.mode === 'paper') {
      notifier.pushMessage(title, message)
    }
  }

  function isFiat() {
    return !s.currency.match(/^BTC|ETH|XMR|USDT$/)
  }

  function initBuffer (trade) {
    let d = tb(trade.time).resize(so.period_length)
    let de = tb(trade.time).resize(so.period_length).add(1)
    s.period = {
      period_id: d.toString(),
      size: so.period_length,
      time: d.toMilliseconds(),
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume: 0,
      close_time: de.toMilliseconds() - 1,
      calc_close_time: tb(trade.time).resize(so.period_calc).add(1).toMilliseconds() - 1
    }
  }

  //Funzione per ricavare il prezzo di acquisto partendo da quote.bid, considerando il markdown_buy_pct e l'opzione best_bid
  function nextBuyForQuote(s, quote) {
    // if (s.next_buy_price)
    //   return n(s.next_buy_price).format(s.product.increment, Math.floor)
    // else {
    debug.msg('nextBuyForQuote - bid=' + quote.bid + ' return=' + n(quote.bid).subtract(n(quote.bid).multiply(s.options.markdown_buy_pct / 100)).add(so.best_bid ? s.product.increment : 0).format(s.product.increment, Math.floor))
    return n(quote.bid).subtract(n(quote.bid).multiply(s.options.markdown_buy_pct / 100)).add(so.best_bid ? s.product.increment : 0).format(s.product.increment, Math.floor)
    // }
  }

  //Funzione per ricavare il prezzo di vendita partendo da quote.ask, considerando il markup_sell_pct e l'opzione best_ask
  function nextSellForQuote(s, quote) {
    // if (s.next_sell_price)
    //   return n(s.next_sell_price).format(s.product.increment, Math.ceil)
    // else
    debug.msg('nextSellForQuote - bid=' + quote.ask + ' return=' + n(quote.ask).add(n(quote.ask).multiply(s.options.markup_sell_pct / 100)).subtract(so.best_ask ? s.product.increment : 0).format(s.product.increment, Math.ceil))
    return n(quote.ask).add(n(quote.ask).multiply(s.options.markup_sell_pct / 100)).subtract(so.best_ask ? s.product.increment : 0).format(s.product.increment, Math.ceil)
  }

  //Aggiorna i dati di s.period con quelli di trade
  function updatePeriod(trade) {
    //debug.msg('updatePeriod')
    s.period.high = Math.max(trade.price, s.period.high)
    s.period.low = Math.min(trade.price, s.period.low)
    s.period.close = trade.price
    s.period.volume += trade.size
    s.period.latest_trade_time = trade.time
    s.strategy.calculate(s)
    s.vol_since_last_blink += trade.size

    //debug.msg('trade.size=' + trade.size)
    //debug.msg('s.period.volume=' + s.period.volume)
    
    //Se c'è stato un nuovo trade, aggiungilo a s.trades
    if (s.trades && s.last_trade_id !== trade.trade_id) {
      s.trades.push(trade)
      s.last_trade_id = trade.trade_id
    }
  }

  //Controlla se è scattato uno stop e nel caso eseguilo
  function executeStop (do_sell_stop) {
    let stop_signal
    // if(!so.quantum_size) {
    // if (s.my_trades.length || s.my_prev_trades.length) {
    // var last_trade
    // if (s.my_trades.length) {
    // last_trade = s.my_trades[s.my_trades.length - 1]
    // } else {
    // last_trade = s.my_prev_trades[s.my_prev_trades.length - 1]
    // }
    // s.last_trade_worth = last_trade.type === 'buy' ? (s.period.close - last_trade.price) / last_trade.price : (last_trade.price - s.period.close) / last_trade.price
    // if (!s.acted_on_stop) {
    // if (last_trade.type === 'buy') {
    // if (do_sell_stop && s.sell_stop && s.period.close < s.sell_stop) {
    // stop_signal = 'sell'
    // console.log(('\nsell stop triggered at ' + formatPercent(s.last_trade_worth) + ' trade worth\n').red)
    // }
    // else if (so.profit_stop_enable_pct && s.last_trade_worth >= (so.profit_stop_enable_pct / 100)) {
    // s.profit_stop_high = Math.max(s.profit_stop_high || s.period.close, s.period.close)
    // s.profit_stop = s.profit_stop_high - (s.profit_stop_high * (so.profit_stop_pct / 100))
    // }
    // if (s.profit_stop && s.period.close < s.profit_stop && s.last_trade_worth > 0) {
    // stop_signal = 'sell'
    // console.log(('\nprofit stop triggered at ' + formatPercent(s.last_trade_worth) + ' trade worth\n').green)
    // }
    // }
    // else {
    // if (s.buy_stop && s.period.close > s.buy_stop) {
    // stop_signal = 'buy'
    // console.log(('\nbuy stop triggered at ' + formatPercent(s.last_trade_worth) + ' trade worth\n').red)
    // }
    // }
    // }
    // }
    // }
    // else {
    //Esegue il controllo per ogni posizione aperta
    s.my_positions.forEach( function (position, index) {
      //s.trade_worth = position.type === 'buy' ? (s.period.close - position.price) / position.price : (position.price - s.period.close) / position.price
      if (!s.acted_on_stop) {
        // if (position.type === 'buy') {
        if (do_sell_stop && position.sell_stop && s.period.close < position.sell_stop) {
          // if (do_sell_stop && position.sell_stop && s.period.close < position.sell_stop) {
          stop_signal = 'sell'
          console.log(('\nsell stop triggered at ' + formatPercent(position.profit_pct) + ' trade profit for position ' + index + '\n').red)
        }
        else if (so.profit_stop_enable_pct && position.profit_pct >= (so.profit_stop_enable_pct / 100)) {
          position.profit_stop_high = Math.max(position.profit_stop_high || s.period.close, s.period.close)
          position.profit_stop = position.profit_stop_high - (position.profit_stop_high * (so.profit_stop_pct / 100))
        }
        if (position.profit_stop && s.period.close < position.profit_stop && position.profit_pct > 0) {
          stop_signal = 'sell'
          console.log(('\nprofit stop triggered at ' + formatPercent(position.profit_pct) + ' trade profit for position ' + index + '\n').green)
        }
        // }
        // else {
        // if (s.buy_stop && s.period.close > s.buy_stop) {
        // stop_signal = 'buy'
        // console.log(('\nbuy stop triggered at ' + formatPercent(position.profit_pct) + ' trade worth for position ' + index + '\n').red)
        // }
        // }
      }
    })
    // }
    if (stop_signal) {
      s.signal = stop_signal
      s.acted_on_stop = true
    }
  }

  function syncBalance (cb) {
    let pre_asset = so.mode === 'sim' ? s.sim_asset : s.balance.asset
    s.exchange.getBalance({currency: s.currency, asset: s.asset}, function (err, balance) {
      if (err) return cb(err)
      let diff_asset = n(pre_asset).subtract(balance.asset)
      s.balance = balance
      getQuote(function (err, quote) {
        if (err) return cb(err)

        let post_currency = n(diff_asset).multiply(quote.ask)
        s.asset_capital = n(s.balance.asset).multiply(quote.ask).value()
        let deposit = so.deposit ? Math.max(0, n(so.deposit).subtract(s.asset_capital)) : s.balance.currency // zero on negative
        s.balance.deposit = n(deposit < s.balance.currency ? deposit : s.balance.currency).value()
        if (!s.start_capital) {
          s.start_price = n(quote.ask).value()
          s.start_capital = n(s.balance.deposit).add(s.asset_capital).value()
          s.real_capital = n(s.balance.currency).add(s.asset_capital).value()
          s.net_currency = s.balance.deposit

          if (so.mode !== 'sim') {
//            pushMessage('Balance ' + s.exchange.name.toUpperCase(), 'Virtual ' + formatCurrency(s.real_capital, s.currency)  + ' (' + formatCurrency(s.balance.currency, s.currency) + ' ' + formatAsset(s.balance.asset, s.asset) + ')')
        	updateMessage()
          }
        }
        else {
          s.net_currency = n(s.net_currency).add(post_currency).value()
        }

        cb(null, { balance, quote })
      })
    })
  }

  function placeOrder (type, opts, cb) {
    if (!s[type + '_order']) {
      s[type + '_order'] = {
        price: opts.price,
        size: opts.size,
        fee: opts.fee,
        orig_size: opts.size,
        remaining_size: opts.size,
        orig_price: opts.price,
        order_type: opts.is_taker ? 'taker' : so.order_type,
        cancel_after: so.cancel_after || 'day'
      }
    }
    debug.msg('placeOrder - order' + type)
    //debug.msg('s[_order] creato? ' + (s[type + '_order']? 'Creato' : 'Non creato'))
    let order = s[type + '_order']
    order.price = opts.price
    order.size = opts.size
    order.fee = opts.fee
    order.remaining_size = opts.size

    order.product_id = s.product_id
    order.post_only = conf.post_only
    let order_copy = JSON.parse(JSON.stringify(order))

    //Piazza l'ordine sull'exchange
    s.exchange[type](order_copy, function (err, api_order) {
      if (err) return cb(err)
      s.api_order = api_order

      //Nel caso di rifiuto dell'ordine...
      if (api_order.status === 'rejected') {
        if (api_order.reject_reason === 'post only') {
          // trigger immediate price adjustment and re-order
          debug.msg('placeOrder - post-only ' + type + ' failed, re-ordering')
          return cb(null, null)
        }
        else if (api_order.reject_reason === 'balance') {
          // treat as a no-op.
          debug.msg('placeOrder - not enough balance for ' + type + ', aborting')
          return cb(null, false)
        }
        else if (api_order.reject_reason === 'price') {
          // treat as a no-op.
          debug.msg('placeOrder - invalid price for ' + type + ', aborting')
          return cb(null, false)
        }
        err = new Error('\norder rejected')
        err.order = api_order
        return cb(err)
      }
      debug.msg('placeOrder - ' + type + ' order placed at ' + formatCurrency(order.price, s.currency))
      order.order_id = api_order.id

      //Con ordine piazzato, lo marca temporalmente
      if (!order.time) {
        order.orig_time = new Date(api_order.created_at).getTime()
      }
      order.time = new Date(api_order.created_at).getTime()
      order.local_time = now()
      order.status = api_order.status
      //console.log('\ncreated ' + order.status + ' ' + type + ' order: ' + formatAsset(order.size) + ' at ' + formatCurrency(order.price) + ' (total ' + formatCurrency(n(order.price).multiply(order.size)) + ')\n')

      setTimeout(function() { checkOrder(order, type, cb) }, so.order_poll_time)
    })
  }

  function getQuote (cb) {
    s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
      if (err) return cb(err)
      s.quote = quote
      cb(null, quote)
    })
  }

  // if s.signal
  // 1. sync balance
  // 2. get quote
  // 3. calculate size/price
  // 4. validate size against min/max sizes
  // 5. cancel old orders
  // 6. place new order
  // 7. record order ID and start poll timer
  // 8. if not filled after timer, repeat process
  // 9. if filled, record order stats
  function executeSignal (signal, _cb, size, is_reorder, is_taker) {
    let price, expected_fee //, trades

    debug.msg('executeSignal: ' + signal + ' ' + is_reorder)
    debug.msg(s[signal + '_order']? 's[_order] esiste' : 's[_order] non esiste')
    
    let cb = function (err, order) {
      if (!order) {
        debug.msg('executeSignal - cb: cancello s[_order]')
    	if (signal === 'buy') delete s.buy_order
        else delete s.sell_order
      }
      if (err) {
        if (_cb) {
          _cb(err)
        }
        else if (err.message.match(nice_errors)) {
          console.error((err.message + ': ' + err.desc).red)
        } else {
          memDump()
          console.error('\n')
          console.error(err)
          console.error('\n')
        }
      }
      else if (_cb) {
        _cb(null, order)
      }
    }

    //Controllo se il watchdog è attivo
    if (s.is_dump_watchdog || s.is_pump_watchdog) {
      let err = new Error('\npumpdump watchdog')
      err.desc = 'refusing to buy/sell. ' + (s.is_dump_watchdog ? 'Dump ' : 'Pump ') + ' Watchdog is active! Positions opened: ' + s.my_positions.length + '\n'
      return cb(err)
    }

    //Controllo se è passato il buy/sell_calmdown
    if (so.buy_calmdown && s.signal == 'buy') {
      if ((now() - (so.buy_calmdown*60*1000)) < s.last_buy_time) {
        let err = new Error('\nBuySell calmdown')
        err.desc = moment().format('YYYY-MM-DD HH:mm:ss') + ' - refusing to buy. Buy Calmdown is active! Last buy ' + moment(s.last_buy_time).format('YYYY-MM-DD HH:mm:ss') + ' Positions opened: ' + s.my_positions.length + '\n'
        return cb(err)
      }
    } else if (so.sell_calmdown && s.signal == 'sell') {
      if ((now() - (so.sell_calmdown*60*1000)) < s.last_sell_time) {
        let err = new Error('\nBuySell calmdown')
        err.desc = moment().format('YYYY-MM-DD HH:mm:ss') + ' - refusing to sell. Sell Calmdown is active! Last sell ' + moment(s.last_sell_time).format('YYYY-MM-DD HH:mm:ss') + ' Positions opened: ' + s.my_positions.length + '\n'
        return cb(err)
      }
    }

    //Cancella gli ordini di senso opposto ancora in piedi
    delete s[(signal === 'buy' ? 'sell' : 'buy') + '_order']

    s.last_signal = signal

    if (!is_reorder && s[signal + '_order']) {
      debug.msg('executeSignal: !is_reorder && esiste s[signal + "_order"]')
      if (is_taker) s[signal + '_order'].order_type = 'taker'
      // order already placed
      _cb && _cb(null, null)
      return
    }
    s.acted_on_trend = true

    syncBalance(function (err, { quote }) {
      if (err) {
        debug.msg('error getting balance')
      }
      let fee, trade_balance, tradeable_balance, expected_fee
      if (err) {
        err.desc = 'could not execute ' + signal + ': error fetching quote'
        return cb(err)
      }
      // if (!so.quantum_size) {
      // if (is_reorder && s[signal + '_order']) {
      // if (signal === 'buy') {
      // reorder_pct = n(size).multiply(s.buy_order.price).add(s.buy_order.fee).divide(s.balance.deposit).multiply(100)
      // } else {
      // reorder_pct = n(size).divide(s.balance.asset).multiply(100)
      // }
      // debug.msg('price changed, resizing order, ' + reorder_pct + '% remain')
      // size = null
      // }
      // }
      // else {
      if (is_reorder && s[signal + '_order']) {
        //Se il signal è buy, il valore di buy_pct lo calcolo direttamente più avanti
        //Se il signal è sell, devo vendere proprio _size_ passato a executeSignal
        debug.msg('executeSignal - price changed, resizing order, ' + formatCurrency(s[signal + '_order'].remaining_size, s.asset) + ' remain')
        size = null
      }
      // }

      // //Se esiste s.my_prev_trades, lo mette in trades concatenato s.my_trades, altrimenti mette in trades una copia di s.my_trades
      // if (s.my_prev_trades.length) {
      //   //debug.msg('Concateno my_prev_trades a my_trades')
      //   //debug.msg('trades= ' + s.my_trades.length + '     prev_trades= ' + s.my_prev_trades.length)
      //   trades = _.concat(s.my_prev_trades, s.my_trades)
      //   //debug.msg('Risultato= ' + trades.length)
      // } else {
      //   trades = _.cloneDeep(s.my_trades)
      // }

      if (signal === 'buy') {
        price = nextBuyForQuote(s, quote)
        
      //Controllo Limit Price Protection
      if (so.buy_price_limit != null && price > so.buy_price_limit) {
        let err = new Error('\nPrice limit protection')
        err.desc = 'refusing to buy at ' + formatCurrency(price, s.currency) + ', buy price limit -> ' + formatCurrency(so.buy_price_limit, s.currency) + '\n'
        pushMessage('Price limit protection', 'aborting')
        return cb(err)
      }
    
        // if (!so.quantum_size) {
        // if (is_reorder) {
        // buy_pct = reorder_pct
        // } else {
        // buy_pct = so.buy_pct
        // }
        // }
        // else {
        // debug.msg('Quantum buy order')
        if (is_reorder) {
          // buy_pct = n(s[signal + '_order'].remaining_size).multiply(price).multiply(100).divide(s.balance.deposit)
          size = n(s[signal + '_order'].remaining_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
          debug.msg('executeSignal - Remaining size: ' + formatAsset(s[signal + '_order'].remaining_size, s.asset))
        } else {
          size = n(so.quantum_size).divide(price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
          debug.msg('executeSignal - Size: ' + formatAsset(size, s.asset) + ' (' + formatCurrency(so.quantum_size, s.currency) + ' su ' + formatCurrency(s.balance.deposit, s.currency) + ')')
        }
        // }

        if (so.use_fee_asset) {
          fee = 0
          // } else if (so.order_type === 'maker' && (buy_pct + s.exchange.takerFee < 100 || !s.exchange.makerBuy100Workaround)) {
        } else if (so.order_type === 'maker') {
          fee = s.exchange.makerFee
        } else {
          fee = s.exchange.takerFee
        }

        trade_balance = (size * price)
        tradeable_balance = trade_balance * 100 / (100 + fee)
        expected_fee = n(trade_balance).subtract(tradeable_balance).format('0.00000000', Math.ceil) // round up as the exchange will too

        // if (!so.quantum_size){
        // if (buy_pct + fee < 100) {
        // size = n(tradeable_balance).divide(price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
        // } else {
        // size = n(trade_balance).subtract(expected_fee).divide(price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
        // }
        // }
        // else {
        //Da sistemare: size è diverso da orig.size se inserisco anche i fee come nel caso non quantum
        //size = n(trade_balance).divide(price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
        // }

        if ((s.product.min_size && Number(size) >= Number(s.product.min_size)) || ('min_total' in s.product && s.product.min_total && n(size).multiply(price).value() >= Number(s.product.min_total))) {
          if (s.product.max_size && Number(size) > Number(s.product.max_size)) {
            size = s.product.max_size
          }
          debug.msg('executeSignal - preparing buy order over ' + formatAsset(size, s.asset) + ' of ' + formatCurrency(tradeable_balance, s.currency) + ' tradeable balance with a expected fee of ' + formatCurrency(expected_fee, s.currency) + ' (' + fee + '%)')

          //Controllo se ho raggiunto il numero massimo di quantum acquistabili
          if (s.my_positions.length >= so.max_nr_quantum) {
            let err = new Error('\nmax quantum reached')
            err.desc = 'refusing to buy. Max nr of quantum (' + so.max_nr_quantum + ') reached. Positions opened: ' + s.my_positions.length
            return cb(err)
          }

          // let latest_low_sell = _.chain(trades).dropRightWhile(['type','buy']).takeRightWhile(['type','sell']).sortBy(['price']).head().value() // return lowest price
          // let buy_loss = latest_low_sell ? (latest_low_sell.price - Number(price)) / latest_low_sell.price * -100 : null

          // if (!so.quantum_size && so.max_buy_loss_pct != null && buy_loss > so.max_buy_loss_pct) {
          // let err = new Error('\nloss protection')
          // err.desc = 'refusing to buy at ' + formatCurrency(price, s.currency) + ', buy loss of ' + formatPercent(buy_loss / 100)
          // return cb(err)
          // }

          //Controllo slippage
          if (s.buy_order && so.max_slippage_pct != null) {
            let slippage = n(price).subtract(s.buy_order.orig_price).divide(s.buy_order.orig_price).multiply(100).value()
            if (so.max_slippage_pct != null && slippage > so.max_slippage_pct) {
              let err = new Error('\nslippage protection')
              err.desc = 'refusing to buy at ' + formatCurrency(price, s.currency) + ', slippage of ' + formatPercent(slippage / 100)
              pushMessage('Slippage protection', 'aborting')
              return cb(err)
            }
          }

          //Controllo currency in hold
          if (n(s.balance.deposit).subtract(s.balance.currency_hold || 0).value() < n(price).multiply(size).value() && s.balance.currency_hold > 0) {
            debug.msg('executeSignal - buy delayed: ' + formatPercent(n(s.balance.currency_hold || 0).divide(s.balance.deposit).value()) + ' of funds (' + formatCurrency(s.balance.currency_hold, s.currency) + ') on hold')
            return setTimeout(function () {
              if (s.last_signal === signal) {
                executeSignal(signal, cb, size, true)
              }
            }, conf.wait_for_settlement)
          }
          else {
            pushMessage('Buying ' + s.exchange.name.toUpperCase(), 'placing buy order at ' + formatCurrency(price, s.currency) + ', ' + formatCurrency(n(quote.bid - Number(price)).format('0.00'), s.currency) + ' under best bid\n')
            doOrder()
          }
        }
        else {
          cb(null, null)
        }
      }
      else if (signal === 'sell') {
        price = nextSellForQuote(s, quote)

        // if (!so.quantum_size) {
        // if (is_reorder) {
        // sell_pct = reorder_pct
        // } else {
        // sell_pct = so.sell_pct
        // }
        // size = n(s.balance.asset).multiply(sell_pct / 100).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')

        // if ((s.product.min_size && Number(size) >= Number(s.product.min_size)) || (s.product.min_total && n(size).multiply(price).value() >= Number(s.product.min_total))) {
        // if (s.product.max_size && Number(size) > Number(s.product.max_size)) {
        // size = s.product.max_size
        // }
        // let latest_high_buy = _.chain(trades).dropRightWhile(['type','sell']).takeRightWhile(['type','buy']).sortBy(['price']).reverse().head().value() // return highest price
        // let sell_loss = latest_high_buy ? (Number(price) - latest_high_buy.price) / latest_high_buy.price * -100 : null
        // if (so.max_sell_loss_pct != null && sell_loss > so.max_sell_loss_pct) {
        // let err = new Error('\nloss protection')
        // err.desc = 'refusing to sell at ' + formatCurrency(price, s.currency) + ', sell loss of ' + formatPercent(sell_loss / 100)
        // return cb(err)
        // }
        // else {
        // if (s.sell_order && so.max_slippage_pct != null) {
        // let slippage = n(s.sell_order.orig_price).subtract(price).divide(price).multiply(100).value()
        // if (slippage > so.max_slippage_pct) {
        // let err = new Error('\nslippage protection')
        // err.desc = 'refusing to sell at ' + formatCurrency(price, s.currency) + ', slippage of ' + formatPercent(slippage / 100)
        // return cb(err)
        // }
        // }
        // if (n(s.balance.asset).subtract(s.balance.asset_hold || 0).value() < n(size).value()) {
        // debug.msg('sell delayed: ' + formatPercent(n(s.balance.asset_hold || 0).divide(s.balance.asset).value()) + ' of funds (' + formatAsset(s.balance.asset_hold, s.asset) + ') on hold')
        // return setTimeout(function () {
        // if (s.last_signal === signal) {
        // executeSignal(signal, cb, size, true)
        // }
        // }, conf.wait_for_settlement)
        // }
        // else {
        // pushMessage('Selling ' + s.exchange.name.toUpperCase(), 'placing sell order at ' + formatCurrency(price, s.currency) + ', ' + formatCurrency(Number(price) - quote.bid, s.currency) + ' over best ask\n')
        // doOrder()
        // }
        // }
        // }
        // else {
        // cb(null, null)
        // }
        // }
        // else {
        // debug.msg('Quantum sell order')

        if (is_reorder) {
          debug.msg('executeSignal - is_reorder')
          size = n(s[signal + '_order'].remaining_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
        } else if (s.my_positions.length) {
          debug.msg('executeSignal - Not is_reorder: position_max_profit_index ' + position_max_profit_index)
          let position = s.my_positions[position_max_profit_index]
          size = (position.size < s.balance.asset) ? n(position.size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000') : s.balance.asset
          working_position_index = position_max_profit_index

          //debug
          debug.printPosition(position)
          debug.msg('executeSignal - size to sell: ' + size)

          //Controllo profitto della posizione
          let sell_loss = (Number(price) - position.price) / position.price * -100
          if (so.max_sell_loss_pct != null && sell_loss > so.max_sell_loss_pct) {
            let err = new Error('\nPosition ' + working_position_index + ' ProfitLoss protection')
            if (so.max_sell_loss_pct > 0) {
              err.desc = 'refusing to sell at ' + formatCurrency(price, s.currency) + ', sell LOSS of ' + formatPercent(sell_loss / 100) + ' > ' + formatPercent(so.max_sell_loss_pct / 100) + '\n'
              //pushMessage('Sell LOSS protection', 'aborting')
            }
            else {
              err.desc = 'refusing to sell at ' + formatCurrency(price, s.currency) + ', sell PROFIT of ' + formatPercent(-sell_loss / 100) + ' < ' + formatPercent(-so.max_sell_loss_pct / 100) + '\n'
              //pushMessage('Sell PROFIT protection', 'aborting')
            }
            return cb(err)
          }
        }

        //Controllo quantità dentro valori max e min commerciabili
        if ((s.product.min_size && Number(size) >= Number(s.product.min_size)) || (s.product.min_total && n(size).multiply(price).value() >= Number(s.product.min_total))) {
          if (s.product.max_size && Number(size) > Number(s.product.max_size)) {
            debug.msg('executeSignal - size = s.product.max_size')
            size = s.product.max_size
          }

          //Controllo slippage
          if (s.sell_order && so.max_slippage_pct != null) {
            let slippage = n(s.sell_order.orig_price).subtract(price).divide(price).multiply(100).value()
            if (slippage > so.max_slippage_pct) {
              let err = new Error('\nslippage protection')
              err.desc = 'refusing to sell at ' + formatCurrency(price, s.currency) + ', slippage of ' + formatPercent(slippage / 100 + '\n')
              pushMessage('Slippage protection', 'aborting')
              return cb(err)
            }
          }

          //Controllo asset in hold
          if (n(s.balance.asset).subtract(s.balance.asset_hold || 0).value() < n(size).value()) {
            debug.msg('executeSignal - sell delayed: ' + formatPercent(n(s.balance.asset_hold || 0).divide(s.balance.asset).value()) + ' of funds (' + formatAsset(s.balance.asset_hold, s.asset) + ') on hold')
            debug.msg('executeSignal - s.balance.asset ' + s.balance.asset + ' s.balance.asset_hold ' + s.balance.asset_hold + ' size ' + size)
            return setTimeout(function () {
              if (s.last_signal === signal) {
                executeSignal(signal, cb, size, true)
              }
            }, conf.wait_for_settlement)
          }
          else {
            pushMessage('Selling ' + formatAsset(size, s.asset) + ' on ' + s.exchange.name.toUpperCase(), 'placing sell order at ' + formatCurrency(price, s.currency) + ', ' + formatCurrency(n(Number(price) - quote.bid).format('0.00'), s.currency) + ' over best ask\n')
            //debug.msg('Selling -> doOrder')
            doOrder()
          }
        }
        else {
          debug.msg('executeSignal - size < s.product.min_size.')
          cb(null, null)
        }
        // }
      }
    })

    function doOrder () {
      //debug.msg('doOrder')
      placeOrder(signal, {
        size: size,
        price: price,
        fee: expected_fee || null,
        is_taker: is_taker,
        cancel_after: so.cancel_after || 'day'
      }, function (err, order) {
        if (err) {
          err.desc = 'could not execute ' + signal + ': error placing order'
          return cb(err)
        }

        //Gestione eccezioni ed errori
        if (!order) {
          if (order === false) {
            // not enough balance, or signal switched.
            debug.msg('doOrder - not enough balance, or signal switched, cancel ' + signal)
            return cb(null, null)
          }
          if (s.last_signal !== signal) {
            // order timed out but a new signal is taking its place
            debug.msg('doOrder - signal switched, cancel ' + signal)
            return cb(null, null)
          }
          // order timed out and needs adjusting
          debug.msg('doOrder - ' + signal + ' order timed out, adjusting price')
          let remaining_size = s[signal + '_order'] ? s[signal + '_order'].remaining_size : size
          if (remaining_size !== size) {
            debug.msg('doOrder - remaining size: ' + remaining_size + ' of ' + s[signal + '_order'].size)
          }
          return executeSignal(signal, _cb, remaining_size, true)
        }
        cb(null, order)
      })
    }
  }

  function executeOrder (trade, type) {
    let price, fee = 0
    if (!so.order_type) {
      so.order_type = 'maker'
    }

    // If order is cancelled, but on the exchange it completed, we need to recover it here
    if (type === 'buy')
      s.buy_order = trade
    else if (type === 'sell')
      s.sell_order = trade

    //Ordine buy
    if (s.buy_order) {
      price = s.buy_order.price
      if (so.order_type === 'maker') {
        if (s.exchange.makerFee) {
          fee = n(s.buy_order.size).multiply(s.exchange.makerFee / 100).value()
        }
      }
      if (so.order_type === 'taker') {
        if (s.exchange.takerFee) {
          fee = n(s.buy_order.size).multiply(s.exchange.takerFee / 100).value()
        }
      }
      s.action = 'bought'
      // if (!s.last_sell_price && s.my_prev_trades.length) {
      // let prev_sells = s.my_prev_trades.filter(trade => trade.type === 'sell')
      // if (prev_sells.length) {
      // s.last_sell_price = prev_sells[prev_sells.length - 1].price
      // }
      // }

      //Archivio il trade in s.my_trades
      let my_trade = {
        order_id: trade.order_id,
        time: trade.time,
        execution_time: trade.time - s.buy_order.orig_time,
        slippage: n(price).subtract(s.buy_order.orig_price).divide(s.buy_order.orig_price).value(),
        type: 'buy',
        size: s.buy_order.orig_size,
        fee: fee,
        price: price,
        order_type: so.order_type || 'taker',
        // profit: s.last_sell_price && (s.last_sell_price - price) / s.last_sell_price, //Da togliere/modificare
        profit: null,
        cancel_after: so.cancel_after || 'day'
      }
      s.my_trades.push(my_trade)

      //Archivio la posizione in s.my_positions
      // if (so.quantum_size) {
      let my_position = {
        order_id: trade.order_id,
        id: crypto.randomBytes(4).toString('hex'),
        selector: so.selector.normalized,
        time: trade.time,
        type: 'buy',
        size: s.buy_order.orig_size,
        fee: fee,
        price: price,
        sell_stop: so.sell_stop_pct && n(price).subtract(n(price).multiply(so.sell_stop_pct/100)).value(),
        profit_pct: null,
        profit_stop_high: null,
        profit_stop: null
      }
      debug.printPosition(my_position)
      s.my_positions.push(my_position)
      // }

      if (so.stats) {
        let order_complete = '\n**** Buy order completed at ' + moment(trade.time).format('YYYY-MM-DD HH:mm:ss') + ':\n\n' + formatAsset(my_trade.size, s.asset) + ' at ' + formatCurrency(my_trade.price, s.currency) + '\nTotal ' + formatCurrency(my_trade.size * my_trade.price, s.currency) + '\n'
        order_complete += n(my_trade.slippage).format('0.0000%') + ' slippage (orig. price ' + formatCurrency(s.buy_order.orig_price, s.currency) + ')\nexecution: ' + moment.duration(my_trade.execution_time).humanize() + '\n'
//        if (so.quantum_size){
        order_complete += 'Positions opened: ' + s.my_positions.length + '\n'
//        }
        console.log((order_complete).cyan)
        pushMessage('Buy ' + s.exchange.name.toUpperCase(), order_complete)
      }
      // s.last_buy_price = my_trade.price
      s.last_buy_time = trade.time
      delete s.buy_order
      // delete s.buy_stop
      // delete s.sell_stop
      // if (!so.quantum_size && so.sell_stop_pct) {
      // s.sell_stop = n(price).subtract(n(price).multiply(so.sell_stop_pct / 100)).value()
      // }
      // delete s.profit_stop
      // delete s.profit_stop_high
      eventBus.emit('orderExecuted', 'buy')
    }

    //Ordine sell
    else if (s.sell_order) {
      price = s.sell_order.price
      if (so.order_type === 'maker') {
        if (s.exchange.makerFee) {
          fee = n(s.sell_order.size).multiply(s.exchange.makerFee / 100).multiply(price).value()
        }
      }
      if (so.order_type === 'taker') {
        if (s.exchange.takerFee) {
          fee = n(s.sell_order.size).multiply(s.exchange.takerFee / 100).multiply(price).value()
        }
      }
      s.action = 'sold'

      //Da togliere
      // if (!s.last_buy_price && s.my_prev_trades.length) {
      // let prev_buys = s.my_prev_trades.filter(trade => trade.type === 'buy')
      // if (prev_buys.length) {
      // s.last_buy_price = prev_buys[prev_buys.length - 1].price
      // }
      // }

      //Archivio il trade in s.my_trades
      let my_trade = {
        order_id: trade.order_id,
        time: trade.time,
        execution_time: trade.time - s.sell_order.orig_time,
        slippage: n(s.sell_order.orig_price).subtract(price).divide(price).value(),
        type: 'sell',
        size: s.sell_order.orig_size,
        fee: fee,
        price: price,
        order_type: so.order_type,
        //profit: s.last_buy_price && (price - s.last_buy_price) / s.last_buy_price
        profit: (price - s.my_positions[working_position_index].price) / s.my_positions[working_position_index].price
      }
      s.my_trades.push(my_trade)

      if (so.stats) {
        let order_complete = '\n**** Sell order completed at ' + moment(trade.time).format('YYYY-MM-DD HH:mm:ss') + ':\n\n' + formatAsset(my_trade.size, s.asset) + ' at ' + formatCurrency(my_trade.price, s.currency) + '\ntotal ' + formatCurrency(my_trade.size * my_trade.price, s.currency) + '\n'
        order_complete += n(my_trade.slippage).format('0.0000%') + ' slippage (orig. price ' + formatCurrency(s.sell_order.orig_price, s.currency) + ')'
        order_complete += '\nBuy price: ' + formatCurrency(s.my_positions[working_position_index].price, s.currency)
        order_complete += '\nProfit: ' + n(my_trade.profit).format('0.0000%')
        order_complete += '\nExecution: ' + moment.duration(my_trade.execution_time).humanize() + '\n'
        // if (so.quantum_size){
        order_complete += 'Positions left: ' + (s.my_positions.length - 1) + '\n'
        // }
        console.log((order_complete).cyan)
        pushMessage('Sell ' + s.exchange.name.toUpperCase(), order_complete)
      }
      
      // if (so.quantum_size) {
      //Elimino la posizione da s.my_positions
      debug.msg('executeOrder - delete position ' + working_position_index + ' (lenght attuale ' + s.my_positions.length +')')
      s.working_position_id = s.my_positions[working_position_index].id
      s.my_positions.splice(working_position_index, 1)


      //debug
      debug.msg('executeOrder - Lista posizioni rimaste')
      debug.printPosition(s.my_positions)
      // }

      // s.last_sell_price = my_trade.price
      s.last_sell_time = trade.time
      //debug.msg('delete signal_order')
      delete s.sell_order
      // delete s.buy_stop
      // if (so.buy_stop_pct) {
      // s.buy_stop = n(price).add(n(price).multiply(so.buy_stop_pct / 100)).value()
      // }
      // delete s.sell_stop
      // delete s.profit_stop
      // delete s.profit_stop_high
      eventBus.emit('orderExecuted', 'sell')
    }
  }

  function now () {
    return new Date().getTime()
  }

  function writeReport (is_progress, blink_off) {
    if ((so.mode === 'sim' || so.mode === 'train') && !so.verbose) {
      if(so.silent) return
      is_progress = true
    }
    else if (is_progress && typeof blink_off === 'undefined' && s.vol_since_last_blink) {
      s.vol_since_last_blink = 0
      setTimeout(function () {
        writeReport(true, true)
      }, 200)
      setTimeout(function () {
        writeReport(true, false)
      }, 400)
      setTimeout(function () {
        writeReport(true, true)
      }, 600)
      setTimeout(function () {
        writeReport(true, false)
      }, 800)
    }
    readline.clearLine(process.stdout)
    readline.cursorTo(process.stdout, 0)
    process.stdout.write(moment(is_progress ? s.period.latest_trade_time : tb(s.period.time).resize(so.period_length).add(1).toMilliseconds()).format('YYYY-MM-DD HH:mm:ss')[is_progress && !blink_off ? 'bgBlue' : 'grey'])
    process.stdout.write('  ' + formatCurrency(s.period.close, s.currency, true, true, true) + ' ' + s.product_id.grey)
    if (s.lookback[0]) {
      let diff = (s.period.close - s.lookback[0].close) / s.lookback[0].close
      process.stdout.write(z(8, formatPercent(diff), ' ')[diff >= 0 ? 'green' : 'red'])
    }
    else {
      process.stdout.write(z(9, '', ' '))
    }
    let volume_display = s.period.volume > 99999 ? abbreviate(s.period.volume, 2) : n(s.period.volume).format('0.00')
    volume_display = z(8, volume_display, ' ')
    if (volume_display.indexOf('.') === -1) volume_display = ' ' + volume_display
    process.stdout.write(volume_display[is_progress && blink_off ? 'cyan' : 'grey'])
    rsi(s, 'rsi', so.rsi_periods)
    if (typeof s.period.rsi === 'number') {
      let half = 5
      let bar = ''
      let stars = 0
      let rsi = n(s.period.rsi).format('00.00')
      if (s.period.rsi >= 50) {
        stars = Math.min(Math.round(((s.period.rsi - 50) / 50) * half) + 1, half)
        bar += ' '.repeat(half - (rsi < 100 ? 3 : 4))
        bar += rsi.green + ' '
        bar += '+'.repeat(stars).green.bgGreen
        bar += ' '.repeat(half - stars)
      }
      else {
        stars = Math.min(Math.round(((50 - s.period.rsi) / 50) * half) + 1, half)
        bar += ' '.repeat(half - stars)
        bar += '-'.repeat(stars).red.bgRed
        bar += rsi.length > 1 ? ' ' : '  '
        bar += rsi.red
        bar += ' '.repeat(half - 3)
      }
      process.stdout.write(' ' + bar)
    }
    else {
      process.stdout.write(' '.repeat(11))
    }
    if (s.strategy.onReport) {
      let cols = s.strategy.onReport.call(s.ctx, s)
      cols.forEach(function (col) {
        process.stdout.write(col)
      })
    }
    if (s.buy_order) {
      process.stdout.write(z(9, 'buying', ' ').green)
    }
    else if (s.sell_order) {
      process.stdout.write(z(9, 'selling', ' ').red)
    }
    else if (s.action) {
      process.stdout.write(z(9, s.action, ' ')[s.action === 'bought' ? 'green' : 'red'])
    }
    else if (s.signal) {
      process.stdout.write(z(9, s.signal || '', ' ')[s.signal ? s.signal === ('pump' || 'dump') ? 'white' : s.signal === 'buy' ? 'green' : 'red' : 'grey'])
    }
    else if (s.is_dump_watchdog || s.is_pump_watchdog) {
      process.stdout.write(z(9, 'P/D Calm', ' ')['grey'])
    }
    // else if (s.last_trade_worth && !s.buy_order && !s.sell_order) {
    // process.stdout.write(z(8, formatPercent(s.last_trade_worth), ' ')[s.last_trade_worth > 0 ? 'green' : 'red'])
    // }
    else if (position_max_profit_index) { //] && !s.buy_order && !s.sell_order) {
      process.stdout.write(z(9, formatPercent(s.my_positions[position_max_profit_index].profit_pct), ' ')[s.my_positions[position_max_profit_index].profit_pct > 0 ? 'green' : 'red'])
    }
    else {
      process.stdout.write(z(9, '', ' '))
    }
    let orig_capital = s.orig_capital || s.start_capital
    let orig_price = s.orig_price || s.start_price
    if (orig_capital) {
      let asset_col = n(s.balance.asset).format(s.asset === 'BTC' ? '0.00000' : '0.00000000') + ' ' + s.asset
      asset_col_width = Math.max(asset_col.length + 1, asset_col_width)
      process.stdout.write(z(asset_col_width, asset_col, ' ').white)
      let deposit_col = n(s.balance.deposit).format(isFiat() ? '0.00' : '0.00000000') + ' ' + s.currency
      deposit_col_width = Math.max(deposit_col.length + 1, deposit_col_width)
      process.stdout.write(z(deposit_col_width, deposit_col, ' ').yellow)
      if (so.deposit) {
        let currency_col = n(s.balance.currency).format(isFiat() ? '0.00' : '0.00000000') + ' ' + s.currency
        currency_col_width = Math.max(currency_col.length + 1, currency_col_width)
        process.stdout.write(z(currency_col_width, currency_col, ' ').green)
        let circulating = s.balance.currency > 0 ? n(s.balance.deposit).divide(s.balance.currency) : n(0)
        process.stdout.write(z(8, n(circulating).format('0.00%'), ' ').grey)
      }
      let consolidated = n(s.net_currency).add(n(s.balance.asset).multiply(s.period.close))
      let profit = n(consolidated).divide(orig_capital).subtract(1).value()
      process.stdout.write(z(8, formatPercent(profit), ' ')[profit >= 0 ? 'green' : 'red'])
      let buy_hold = n(orig_capital).divide(orig_price).multiply(s.period.close)
      let over_buy_hold_pct = n(consolidated).divide(buy_hold).subtract(1).value()
      process.stdout.write(z(8, formatPercent(over_buy_hold_pct), ' ')[over_buy_hold_pct >= 0 ? 'green' : 'red'])
    }
    if (!is_progress) {
      process.stdout.write('\n')
    }
  }

  function withOnPeriod (trade, period_id, cb) {
    //debug.msg('withOnPeriod')
    if (!clock && so.mode !== 'live' && so.mode !== 'paper') clock = lolex.install({ shouldAdvanceTime: false, now: trade.time })

    updatePeriod(trade)

    if (!s.in_preroll) {
      if (so.mode !== 'live')
        s.exchange.processTrade(trade)

      if (!so.manual) {
        executeStop()

        if (clock) {
          var diff = trade.time - now()

          // Allow some catch-up if trades are too far apart. Don't want all calls happening at the same time
          while (diff > 5000) {
            clock.tick(5000)
            diff -= 5000
          }
          clock.tick(diff)
        }

        if (s.signal) {
          debug.msg('withOnPeriod: executeSignal ' + s.signal + 'moment= ' + moment())
          executeSignal(s.signal)
        	// Tentativo per evitare la sovrapposizione di ordini.
        	// Con setTimeout, executeSignal viene eseguita dopo un valore random di massimo 10 secondi.
        	// Si presuppone che la precedente, quindi, abbia il tempo di chiamare placeOrder e creare
        	// una istanza di s[___order] per bloccare le seguenti chiamate.
//        	var delay = Math.floor(Math.random()*10) * 1000
//        	debug.msg('withOnPeriod: chiamo executeSignal con un ritardo di ' + delay)
//        	setTimeout(function() { executeSignal(s.signal) }, delay)
          s.signal = null
        }
      }
    }
    //A quanto sembra, s.last_period_id non serve a nulla
    s.last_period_id = period_id
    cb()
  }

  function cancelOrder (order, type, do_reorder, cb) {
    s.exchange.cancelOrder({order_id: order.order_id, product_id: s.product_id}, function () {
      function checkHold (do_reorder, cb) {
        s.exchange.getOrder({order_id: order.order_id, product_id: s.product_id}, function (err, api_order) {
          if (api_order) {
            if (api_order.status === 'done') {
              order.time = new Date(api_order.done_at).getTime()
              order.price = api_order.price || order.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
              debug.msg('cancel failed, order done, executing')
              executeOrder(order, type)
              return syncBalance(function () {
                cb(null, order)
              })
            }

            s.api_order = api_order
            if (api_order.filled_size) {
              order.remaining_size = n(order.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
              debug.msg('cancelOrder: order.remaining_size= ' + order.remaining_size)
              if (!((s.product.min_size && Number(order.remaining_size) >= Number(s.product.min_size)) || (s.product.min_total && n(order.remaining_size).multiply(order.price).value() >= Number(s.product.min_total)))) {
                debug.msg('cancelOrder: order.remaining_size < minimo ordine possibile (o errore equivalente)')
                order.time = new Date(api_order.done_at).getTime()
                debug.msg('cancelOrder: order.time= ' + order.time)
                order.orig_size = order.orig_size - order.remaining_size
                executeOrder(order, type)
                return syncBalance(function () {
                  cb(null, order)
                })
              }
            }
          }
          syncBalance(function () {
            let on_hold
            if (type === 'buy') on_hold = n(s.balance.deposit).subtract(s.balance.currency_hold || 0).value() < n(order.price).multiply(order.remaining_size).value()
            else on_hold = n(s.balance.asset).subtract(s.balance.asset_hold || 0).value() < n(order.remaining_size).value()

            if (on_hold && s.balance.currency_hold > 0) {
              // wait a bit for settlement
              debug.msg('funds on hold after cancel, waiting 5s')
              setTimeout(function() { checkHold(do_reorder, cb) }, conf.wait_for_settlement)
            }
            else {
              cb(null, do_reorder ? null : false)
            }
          })
        })
      }
      checkHold(do_reorder, cb)
    })
  }

  function checkOrder (order, type, cb) {
    //debug.msg('checkOrder')
    if (!s[type + '_order']) {
      // signal switched, stop checking order
      debug.msg('checkOrder - signal switched during ' + type + ', aborting')
      pushMessage('Signal switched during ' + type, ' aborting')
      return cancelOrder(order, type, false, cb)
    }
    s.exchange.getOrder({order_id: order.order_id, product_id: s.product_id}, function (err, api_order) {
      if (err) return cb(err)
      s.api_order = api_order
      order.status = api_order.status
      if (api_order.reject_reason) order.reject_reason = api_order.reject_reason

      //Ordine eseguito!!
      if (api_order.status === 'done') {
        order.time = new Date(api_order.done_at).getTime()
        order.price = api_order.price || order.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
        executeOrder(order, type)

        //Esco dalla funzione, restituendo syncBalance
        return syncBalance(function () {
          cb(null, order)
        })
      }
      if (order.status === 'rejected' && (order.reject_reason === 'post only' || api_order.reject_reason === 'post only')) {
        debug.msg('checkOrder - post-only ' + type + ' failed, re-ordering')
        return cb(null, null)
      }
      if (order.status === 'rejected' && order.reject_reason === 'balance') {
        debug.msg('checkOrder - not enough balance for ' + type + ', aborting')
        return cb(null, null)
      }

      //Controllo se è trascorso so.order_adjust_time senza che l'ordine sia stato eseguito.
      if (now() - order.local_time >= so.order_adjust_time) {
        getQuote(function (err, quote) {
          if (err) {
            err.desc = 'could not execute ' + type + ': error fetching quote'
            return cb(err)
          }
          let marked_price
          if (type === 'buy') {
            //marked_price = nextBuyForQuote(s, quote) Non ha senso, perchè mi restituisce un valore corretto con il markdown/markup, quindi la verifica successiva fallisce sicuramente
            marked_price = quote.bid
            if (so.exact_buy_orders && n(order.price).value() != marked_price) {
              debug.msg('checkOrder - ' + marked_price + ' vs! our ' + order.price)
              cancelOrder(order, type, true, cb)
            }
            else if (n(order.price).value() < marked_price) {
              debug.msg('checkOrder - ' + marked_price + ' vs our ' + order.price)
              cancelOrder(order, type, true, cb)
            }
            else {
              order.local_time = now()
              setTimeout(function() { checkOrder(order, type, cb) }, so.order_poll_time)
            }
          }
          else {
            // marked_price = nextSellForQuote(s, quote) Non ha senso, perchè mi restituisce un valore corretto con il markdown/markup, quindi la verifica successiva fallisce sicuramente
            marked_price = quote.ask
            if (so.exact_sell_orders && n(order.price).value() != marked_price) {
              debug.msg('checkOrder - ' + marked_price + ' vs! our ' + order.price)
              cancelOrder(order, type, true, cb)
            }
            else if (n(order.price).value() > marked_price) {
              debug.msg('checkOrder - ' + marked_price + ' vs our ' + order.price)
              cancelOrder(order, type, true, cb)
            }
            else {
              order.local_time = now()
              setTimeout(function() { checkOrder(order, type, cb) }, so.order_poll_time)
            }
          }
        })
      }
      else {
        setTimeout(function() { checkOrder(order, type, cb) }, so.order_poll_time)
      }
    })
  }

  var tradeProcessingQueue = async.queue(function({trade, is_preroll}, callback){
    onTrade(trade, is_preroll, callback)
  })

  function queueTrade(trade, is_preroll){
    tradeProcessingQueue.push({trade, is_preroll})
  }

  function onTrade(trade, is_preroll, cb) {
    //debug.msg ('onTrade')

    updatePositions(trade)

    //Non ho capito a cosa serve. s.period.time è il tempo di inizio del periodo, dovrebbe
    // essere per forza inferiore a trade.time (da cui deriva), quindi questo if non sarà mai
    // soddisfatto. Boh. Metto un debug per capire se qualche volta entra.
    if (s.period && trade.time < s.period.time) {
      debug.msg('*************************** onTrade. Sono dentro if misterioso *****************************')
    	return
    }

    var day = (new Date(trade.time)).getDate()
    if (s.last_day && day !== s.last_day) {
      s.day_count++
    }
    s.last_day = day

    if (!s.period) {
      initBuffer(trade)
    }

    s.in_preroll = is_preroll || (so.start && trade.time < so.start)
    
    if (trade.time > s.period.close_time) {
      var period_id = tb(trade.time).resize(so.period_length).toString()
      s.strategy.onPeriod.call(s.ctx, s, function () {
        writeReport()
        s.acted_on_stop = false
        if (!s.in_preroll && !so.manual) {
          executeStop(true)
          if (s.signal) {
            //debug.msg('onTrade: executeSignal')
            // Tentativo per evitare la sovrapposizione di ordini.
        	// Con setTimeout, executeSignal viene eseguita dopo un valore random di massimo 10 secondi.
        	// Si presuppone che la precedente, quindi, abbia il tempo di chiamare placeOrder e creare
        	// una istanza di s[___order] per bloccare le seguenti chiamate.
//        	var delay = Math.floor(Math.random()*10) * 1000
//        	debug.msg('onTrade: chiamo executeSignal ' + s.signal + ' con un ritardo di ' + delay)
        	//Devo fare questo passaggio altrimenti s.signal in executeSignal è null (dovuto allo scope di s,
        	// ma non mi è chiaro il motivo)
//        	signal = s.signal
//        	setTimeout(function() { 
//        		debug.msg('signal is: ' + signal)
//        		executeSignal(signal)
//        		}, delay)
//        	
        	debug.msg('onTrade: chiamo executeSignal ' + s.signal + ' Time= ' + moment())
        	executeSignal(s.signal)
          }
        }
        
        //Aggiungi il periodo a s.lookback e a s.calc_lookback
        s.lookback.unshift(s.period)
        if (trade.time > s.period.calc_close_time)
          s.calc_lookback.unshift(s.period)

        s.action = null
        s.signal = null

        initBuffer(trade)
        debug.msg('onTrade: chiamo withOnPeriod oltre period ' + s.signal + ' Time= ' + moment() + ' trade.time= ' + trade.time + ' s.period.close_time= ' + s.period.close_time)
        withOnPeriod(trade, period_id, cb)
      })
    }
    else {
      debug.msg('onTrade: chiamo withOnPeriod dentro period ' + s.signal + ' Time= ' + moment())
      withOnPeriod(trade, period_id, cb)
    }
  }

  function onTrades(trades, is_preroll, cb) {
    if (_.isFunction(is_preroll)) {
      cb = is_preroll
      is_preroll = false
    }
    trades.sort(function (a, b) {
      if (a.time < b.time) return -1
      if (a.time > b.time) return 1
      return 0
    })
    var local_trades = trades.slice(0)
    var trade
    while( (trade = local_trades.shift()) !== undefined ) {
      queueTrade(trade, is_preroll)
    }
    if(_.isFunction(cb)) cb()
  }

  function updatePositions(trade) {
    //debug.msg('updatePositions')
    let max_profit = 0
    s.my_positions.forEach( function (position, index) {
      position.profit_pct = position.type === 'buy' ? (trade.price - position.price) / position.price : (position.price - trade.price) / position.price
      max_profit = (max_profit ? max_profit : position.profit_pct)
      if (so.profit_stop_enable_pct && position.profit_pct >= (so.profit_stop_enable_pct / 100)) {
        position.profit_stop_high = Math.max(position.profit_stop_high || trade.price, trade.price)
        position.profit_stop = position.profit_stop_high - (position.profit_stop_high * (so.profit_stop_pct / 100))
      }
      if (position.profit_pct >= max_profit) {
        max_profit = position.profit_pct
        position_max_profit_index = index
      }
    })
  }
  
  function updateMessage() {
	  var output_lines = []
      output_lines.push('Virtual balance ' + formatCurrency(s.real_capital, s.currency) + ' (' + formatCurrency(s.balance.currency, s.currency) + ' - ' + formatAsset(s.balance.asset, s.asset) + ')')
      output_lines.push('\n' + s.my_trades.length + ' trades over ' + s.day_count + ' days (' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)')
      output_lines.push('\n' + s.my_positions.length + ' positions opened' + (position_max_profit_index ? (' (' + formatPercent(s.my_positions[position_max_profit_index].profit_pct) + ').') : '.'))
	  pushMessage('Status', output_lines)
  }

  return {
    writeHeader: function () {
      process.stdout.write([
        z(19, 'DATE', ' ').grey,
        z(17, 'PRICE', ' ').grey,
        z(9, 'DIFF', ' ').grey,
        z(10, 'VOL', ' ').grey,
        z(8, 'RSI', ' ').grey,
        z(32, 'ACTIONS', ' ').grey,
        z(so.deposit ? 38 : 25, 'BAL', ' ').grey,
        z(22, 'PROFIT', ' ').grey
      ].join('') + '\n')
    },
    update: onTrades,
    exit: function (cb) {
      if(tradeProcessingQueue.length()){
        tradeProcessingQueue.drain = () => {
          if(s.strategy.onExit) {
            s.strategy.onExit.call( s.ctx, s )
          }
          cb()
        }
      } else {
        if(s.strategy.onExit) {
          s.strategy.onExit.call( s.ctx, s )
        }
        cb()
      }
    },

    executeSignal: executeSignal,
    writeReport: writeReport,
    syncBalance: syncBalance,
    updateMessage: updateMessage
  }
}
