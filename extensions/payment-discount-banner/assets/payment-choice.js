// "How would you like to pay?" pop-up (see blocks/payment-choice.liquid).
// Intercepts Check out and Buy it now, asks for the payment method, and sends
// the choice to checkout as the _payment_choice cart attribute.
(function () {
  'use strict';

  var configElement = document.getElementById('payment-choice-config');
  if (!configElement || window.__paymentChoiceLoaded) return;
  window.__paymentChoiceLoaded = true;

  var config;
  try {
    config = JSON.parse(configElement.textContent);
  } catch (error) {
    return;
  }
  var text = config.text;
  var ATTRIBUTE = '_payment_choice';

  // Express buttons (Shop Pay, PayPal...) go straight to checkout and can't be
  // intercepted, so they are hidden; the theme's own Buy it now is replaced.
  var hidden = [];
  if (config.hideExpress) {
    hidden.push(
      '.shopify-payment-button__button--branded',
      '.shopify-payment-button__more-options',
      'shopify-accelerated-checkout',
      'shopify-accelerated-checkout-cart',
      '.additional-checkout-buttons',
      '.cart__dynamic-checkout-buttons'
    );
  }
  if (config.replaceBuyNow) hidden.push('.shopify-payment-button');
  if (hidden.length) {
    var style = document.createElement('style');
    style.textContent = hidden.join(',') + '{display:none !important}';
    document.head.appendChild(style);
  }

  // ---- money ---------------------------------------------------------------

  function decodeEntities(value) {
    var element = document.createElement('textarea');
    element.innerHTML = value;
    return element.value;
  }

  function formatMoney(cents) {
    var format = decodeEntities(config.moneyFormat || '${{amount}}');
    function number(value, decimals, thousands, decimal) {
      var parts = (value / 100).toFixed(decimals).split('.');
      var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return decimals ? whole + decimal + parts[1] : whole;
    }
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, function (_, key) {
      switch (key) {
        case 'amount_no_decimals': return number(cents, 0, ',', '.');
        case 'amount_with_comma_separator': return number(cents, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return number(cents, 0, '.', ',');
        case 'amount_with_apostrophe_separator': return number(cents, 2, "'", '.');
        default: return number(cents, 2, ',', '.');
      }
    });
  }

  // Rounded down to the cent, like Shopify's percentage discounts.
  function saving(cents) {
    return Math.floor((cents * config.percent) / 100);
  }

  // ---- pop-up ---------------------------------------------------------------

  var dialog;
  var onContinue;
  var lastFocus;

  function option(value, label, detail, discounted) {
    var wrapper = document.createElement('label');
    wrapper.className = 'pc-option' + (discounted ? ' pc-option--discounted' : '');
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = 'pc-choice';
    input.value = value;
    var name = document.createElement('span');
    name.className = 'pc-option__name';
    name.textContent = label;
    var note = document.createElement('span');
    note.className = 'pc-option__detail';
    note.textContent = detail;
    wrapper.appendChild(input);
    wrapper.appendChild(name);
    wrapper.appendChild(note);
    return wrapper;
  }

  function close() {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    document.removeEventListener('keydown', onKeydown, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  function open(totalCents, proceed) {
    close();
    lastFocus = document.activeElement;
    onContinue = proceed;

    var amount = formatMoney(saving(totalCents));
    var percent = config.percent + '%';
    var saveText = text.save.replace('[percent]', percent).replace('[amount]', amount);

    dialog = document.createElement('div');
    dialog.className = 'pc-backdrop';
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) close();
    });

    var panel = document.createElement('div');
    panel.className = 'pc-dialog';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'pc-heading');

    var closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'pc-close';
    closeButton.setAttribute('aria-label', text.close);
    closeButton.textContent = '×';
    closeButton.addEventListener('click', close);

    var heading = document.createElement('h2');
    heading.id = 'pc-heading';
    heading.className = 'pc-heading';
    heading.textContent = text.heading;

    var form = document.createElement('form');
    form.className = 'pc-form';
    var list = document.createElement('div');
    list.className = 'pc-options';
    list.setAttribute('role', 'radiogroup');
    list.appendChild(option('bank', text.bank, saveText, true));
    if (config.showCard) {
      list.appendChild(option('card', text.card, config.cardDiscount ? saveText : text.fullPrice, config.cardDiscount));
    }
    list.appendChild(option('cod', text.cod, text.fullPrice, false));

    var initial = list.querySelector('input[value="' + config.defaultChoice + '"]') || list.querySelector('input');
    initial.checked = true;

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'pc-submit button';
    submit.textContent = text.button;

    form.appendChild(list);
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var choice = form.querySelector('input[name="pc-choice"]:checked').value;
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      Promise.resolve(onContinue(choice)).catch(function () {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      });
    });

    panel.appendChild(closeButton);
    panel.appendChild(heading);
    panel.appendChild(form);
    dialog.appendChild(panel);
    document.body.appendChild(dialog);
    document.addEventListener('keydown', onKeydown, true);
    initial.focus();
  }

  // ---- checkout from the cart -----------------------------------------------

  function cartUrl(path) {
    return (config.root || '/').replace(/\/?$/, '/') + path;
  }

  function goToCheckout(choice) {
    var attributes = {};
    attributes[ATTRIBUTE] = choice;
    return fetch(cartUrl('cart/update.js'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({attributes: attributes}),
    }).then(function (response) {
      if (!response.ok) throw new Error('cart update failed');
      window.location.href = cartUrl('checkout');
    });
  }

  var CHECKOUT_TRIGGERS = [
    'button[name="checkout"]',
    'input[name="checkout"]',
    'a[href$="/checkout"]',
    'a[href*="/checkout?"]',
  ].join(',');

  document.addEventListener(
    'click',
    function (event) {
      var trigger = event.target.closest && event.target.closest(CHECKOUT_TRIGGERS);
      if (!trigger || trigger.closest('.pc-dialog')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fetch(cartUrl('cart.js'), {headers: {Accept: 'application/json'}})
        .then(function (response) { return response.json(); })
        .then(function (cart) { open(cart.total_price, goToCheckout); })
        .catch(function () { open(0, goToCheckout); });
    },
    true
  );

  // ---- Buy it now ------------------------------------------------------------

  function buyNow(form) {
    // Follow the theme: if Add to cart is disabled (sold out, no variant), so is this.
    var add = form.querySelector('[name="add"]');
    if (add && add.disabled) return;
    var data = new FormData(form);
    var variantId = data.get('id');
    var quantity = Math.max(1, parseInt(data.get('quantity'), 10) || 1);
    if (!variantId) return;
    var price = config.variantPrices[variantId] || 0;

    open(price * quantity, function (choice) {
      // Cart permalinks don't support selling plans, so those go through the cart.
      if (data.get('selling_plan')) {
        return fetch(cartUrl('cart/add.js'), {method: 'POST', body: data}).then(function () {
          return goToCheckout(choice);
        });
      }
      // Straight to checkout with only this product, like Buy it now.
      window.location.href =
        cartUrl('cart/' + encodeURIComponent(variantId) + ':' + quantity) +
        '?attributes[' + ATTRIBUTE + ']=' + encodeURIComponent(choice);
    });
  }

  function addBuyNowButtons() {
    var containers = document.querySelectorAll('.shopify-payment-button');
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      var form = container.closest('form');
      if (!form || !form.querySelector('[name="id"]')) continue;
      var next = container.nextElementSibling;
      if (next && next.classList.contains('pc-buy-now')) continue;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pc-buy-now button button--full-width button--primary';
      button.textContent = text.buyNow;
      button.addEventListener('click', function (event) {
        event.preventDefault();
        buyNow(event.currentTarget.closest('form'));
      });
      container.parentNode.insertBefore(button, container.nextSibling);
    }
  }

  if (config.replaceBuyNow) {
    addBuyNowButtons();
    // Themes re-render the product form when the variant changes.
    new MutationObserver(addBuyNowButtons).observe(document.body, {childList: true, subtree: true});
  }
})();
