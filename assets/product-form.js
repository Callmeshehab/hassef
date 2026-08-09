if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        this.variantIdInput.disabled = false;
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton.querySelector('span');

        if (document.querySelector('cart-drawer')) this.submitButton.setAttribute('aria-haspopup', 'dialog');

        this.hideErrors = this.dataset.hideErrors === 'true';
      }

      onSubmitHandler(evt) {
        evt.preventDefault();
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        this.querySelector('.loading__spinner').classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(this.form);
        if (this.cart) {
          let sectionIds = [];
          if (typeof this.cart.getSectionsToRender === 'function') {
            sectionIds = this.cart.getSectionsToRender().map((section) => section.id);
          } else {
            sectionIds = ['cart-notification-product', 'cart-notification-button', 'cart-icon-bubble'];
          }
          formData.append('sections', sectionIds);
          formData.append('sections_url', window.location.pathname);
          if (typeof this.cart.setActiveElement === 'function') {
            this.cart.setActiveElement(document.activeElement);
          }
        }
        config.body = formData;

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then((response) => {
            if (response.status) {
              publish(PUB_SUB_EVENTS.cartError, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                errors: response.errors || response.description,
                message: response.message,
              });
              this.handleErrorMessage(response.description);

              const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
              if (!soldOutMessage) return;
              this.submitButton.setAttribute('aria-disabled', true);
              this.submitButtonText.classList.add('hidden');
              soldOutMessage.classList.remove('hidden');
              this.error = true;
              return;
            } else if (!this.cart) {
              window.location = window.routes.cart_url;
              return;
            }

            const startMarker = CartPerformance.createStartingMarker('add:wait-for-subscribers');

            if (!this.error)
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                cartData: response,
              })
              .then(() => {
                CartPerformance.measureFromMarker('add:wait-for-subscribers', startMarker);

                // ─────────────────────────────────────────────────────────────
                // حل محسن لمشكلة اختفاء الـ cart count bubble
                // ─────────────────────────────────────────────────────────────
                const newCount = response.item_count || 0;

                // تحديث كل العناصر المحتملة للـ cart count
                const selectors = [
                  '.cart-count',
                  '.header__cart-count',
                  '.cart-icon__bubble',
                  '.cart-count-bubble',
                  '[data-cart-count]',
                  '.cart-bubble'
                ];

                selectors.forEach(selector => {
                  document.querySelectorAll(selector).forEach(el => {
                    // تحديث النص
                    const textEl = el.querySelector('span') || el;
                    if (textEl) textEl.textContent = newCount;

                    // إظهار العنصر إذا كان مخفي
                    el.classList.remove('hidden', 'visually-hidden');
                    el.style.display = ''; // في حالة كان inline أو flex
                  });
                });

                // تحديث إضافي بعد تأخير بسيط (للحالات اللي فيها re-render)
                setTimeout(() => {
                  document.querySelectorAll(selectors.join(', ')).forEach(el => {
                    const textEl = el.querySelector('span') || el;
                    if (textEl) textEl.textContent = newCount;
                    el.classList.remove('hidden', 'visually-hidden');
                  });
                }, 50);
              });

            this.error = false;

            const quickAddModal = this.closest('quick-add-modal');
            
            const renderCartFallback = () => {
              if (this.cart && typeof this.cart.renderContents === 'function') {
                this.cart.renderContents(response);
              } else if (this.cart) {
                ['cart-notification-product', 'cart-notification-button', 'cart-icon-bubble'].forEach((id) => {
                  if (response.sections[id]) {
                    const el = document.getElementById(id);
                    if (el) {
                      const sectionDoc = new DOMParser().parseFromString(response.sections[id], 'text/html');
                      if (id === 'cart-notification-product') {
                         let targetItem = response.key ? sectionDoc.querySelector(`[id="cart-notification-product-${response.key}"]`) : null;
                         if (!targetItem) {
                           const items = sectionDoc.querySelectorAll('.cart-item');
                           if (items.length > 0) targetItem = items[items.length - 1]; // First or last, whatever is most recent. Wait! usually at top or bottom. We'll use the last added (bottom).
                         }
                         if (!targetItem && sectionDoc.querySelector('.cart-item')) targetItem = sectionDoc.querySelector('.cart-item');
                         el.innerHTML = targetItem ? targetItem.outerHTML : sectionDoc.querySelector('.shopify-section').innerHTML;
                      } else {
                         el.innerHTML = sectionDoc.querySelector('.shopify-section').innerHTML;
                      }
                    }
                  }
                });
                this.cart.classList.add('animate', 'active');
                trapFocus && trapFocus(this.cart);
              }
            };

            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    CartPerformance.measure("add:paint-updated-sections", renderCartFallback);
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else {
              CartPerformance.measure("add:paint-updated-sections", renderCartFallback);
            }
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            this.submitButton.classList.remove('loading');
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            if (!this.error) this.submitButton.removeAttribute('aria-disabled');
            this.querySelector('.loading__spinner').classList.add('hidden');

            CartPerformance.measureFromEvent("add:user-action", evt);
          });
      }

      // باقي الدوال زي ما هي (handleErrorMessage, toggleSubmitButton, variantIdInput)
      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage) {
          this.errorMessage.textContent = errorMessage;
        }
      }

      toggleSubmitButton(disable = true, text) {
        if (disable) {
          this.submitButton.setAttribute('disabled', 'disabled');
          if (text) this.submitButtonText.textContent = text;
        } else {
          this.submitButton.removeAttribute('disabled');
          this.submitButtonText.textContent = window.variantStrings.addToCart;
        }
      }

      get variantIdInput() {
        return this.form.querySelector('[name=id]');
      }
    }
  );
}