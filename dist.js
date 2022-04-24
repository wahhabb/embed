(function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function subscribe(store, ...callbacks) {
        if (store == null) {
            return noop;
        }
        const unsub = store.subscribe(...callbacks);
        return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
    }
    function component_subscribe(component, store, callback) {
        component.$$.on_destroy.push(subscribe(store, callback));
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot_base(slot, slot_definition, ctx, $$scope, slot_changes, get_slot_context_fn) {
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }
    function get_all_dirty_from_scope($$scope) {
        if ($$scope.ctx.length > 32) {
            const dirty = [];
            const length = $$scope.ctx.length / 32;
            for (let i = 0; i < length; i++) {
                dirty[i] = -1;
            }
            return dirty;
        }
        return -1;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function append_styles(target, style_sheet_id, styles) {
        const append_styles_to = get_root_for_style(target);
        if (!append_styles_to.getElementById(style_sheet_id)) {
            const style = element('style');
            style.id = style_sheet_id;
            style.textContent = styles;
            append_stylesheet(append_styles_to, style);
        }
    }
    function get_root_for_style(node) {
        if (!node)
            return document;
        const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
        if (root && root.host) {
            return root;
        }
        return node.ownerDocument;
    }
    function append_stylesheet(node, style) {
        append(node.head || node, style);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        if (value === null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, bubbles = false) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = new Set();
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (const subscriber of subscribers) {
                        subscriber[1]();
                        subscriber_queue.push(subscriber, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.add(subscriber);
            if (subscribers.size === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                subscribers.delete(subscriber);
                if (subscribers.size === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    const display = writable(0);

    /* Calcbtn.svelte generated by Svelte v3.46.4 */

    function add_css$2(target) {
    	append_styles(target, "svelte-p8p3rd", "button.svelte-p8p3rd{background:#777;height:100%;color:white;font-size:130%;font-weight:200;border:none}button.svelte-p8p3rd:active{background:#aaa}.twowide.svelte-p8p3rd{grid-column-end:span 2;text-align:left;padding-left:1.3em}.oper.svelte-p8p3rd{background:#f94;font-size:180%;padding-top:5px}.fn.svelte-p8p3rd,.plusminus.svelte-p8p3rd{background:#555}button.oper.svelte-p8p3rd:active{background:#c72}button.fn.svelte-p8p3rd:active,button.plusminus.svelte-p8p3rd:active{background:#777}");
    }

    function create_fragment$2(ctx) {
    	let button;
    	let button_class_value;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[4].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);

    	return {
    		c() {
    			button = element("button");
    			if (default_slot) default_slot.c();
    			attr(button, "class", button_class_value = "" + (/*width*/ ctx[0] + " " + /*use*/ ctx[1] + " svelte-p8p3rd"));
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);

    			if (default_slot) {
    				default_slot.m(button, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 8)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[3],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[3])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null),
    						null
    					);
    				}
    			}

    			if (!current || dirty & /*width, use*/ 3 && button_class_value !== (button_class_value = "" + (/*width*/ ctx[0] + " " + /*use*/ ctx[1] + " svelte-p8p3rd"))) {
    				attr(button, "class", button_class_value);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    let lastBtn = "";
    let lastOper = "";
    let operand = "";
    let inDecimal = 0;

    function instance$2($$self, $$props, $$invalidate) {
    	let $display;
    	component_subscribe($$self, display, $$value => $$invalidate(6, $display = $$value));
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { width = "" } = $$props;
    	let { use = "number" } = $$props;
    	const dispatch = createEventDispatcher();

    	let calcClick = a => {
    		const btn = a.target.innerHTML;

    		//		console.log("with", btn, lastBtn, lastOper, operand, inDecimal)
    		if ("0" <= btn && btn <= "9") {
    			dispatch('ac', { symbol: btn });

    			if (lastBtn != "number") {
    				display.set(0);
    			}

    			if (inDecimal == 1) {
    				display.set(Number(String($display) + "." + btn));
    				++inDecimal;
    			} else {
    				if (inDecimal) {
    					display.set(Number(String($display) + btn));
    					++inDecimal;
    				} else {
    					display.set($display * 10 + Number(btn));
    				}
    			}

    			lastBtn = "number";
    		} else if (btn == "<sup>+</sup>/<sub>−</sub>") {
    			display.set(-$display);
    		} else {
    			switch (btn) {
    				case ".":
    					if (inDecimal == 0) {
    						inDecimal = 1;

    						if (lastBtn === "operator") {
    							lastBtn = "number";
    							display.set(0);
    						}
    					}
    					break;
    				case "AC":
    					lastOper = "";
    				case "C":
    					display.set(0);
    					lastBtn = "number";
    					a.target.innerHTML = "AC";
    					inDecimal = 0;
    					break;
    				case "%":
    					display.set($display / 100);
    					break;
    				case "+":
    				case "−":
    				case "×":
    				case "÷":
    				case "=":
    					dispatch('func', {
    						symbol: btn, // fall through!	
    						
    					});
    					switch (lastOper) {
    						case "":
    							operand = $display;
    							console.log("for blank:", operand, lastOper, $display);
    							break;
    						case "+":
    							operand += $display;
    							break;
    						case "−":
    							operand -= $display;
    							console.log("for -:", operand, lastOper, $display);
    							break;
    						case "×":
    							operand *= $display;
    							break;
    						case "÷":
    							operand /= $display;
    							break;
    					}
    					display.set(operand);
    					lastBtn = "operator";
    					lastOper = btn;
    					inDecimal = 0;
    					if (btn === "=") {
    						lastOper = "";
    						operand = 0;
    					}
    					break;
    			}
    		}
    	};

    	const click_handler = a => calcClick(a);

    	$$self.$$set = $$props => {
    		if ('width' in $$props) $$invalidate(0, width = $$props.width);
    		if ('use' in $$props) $$invalidate(1, use = $$props.use);
    		if ('$$scope' in $$props) $$invalidate(3, $$scope = $$props.$$scope);
    	};

    	return [width, use, calcClick, $$scope, slots, click_handler];
    }

    class Calcbtn extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { width: 0, use: 1 }, add_css$2);
    	}
    }

    /* Display.svelte generated by Svelte v3.46.4 */

    function add_css$1(target) {
    	append_styles(target, "svelte-1bwsk7c", "div.svelte-1bwsk7c{grid-column-start:1;grid-column-end:5;background-color:#444;color:white;font-weight:100;text-align:right;align-self:end;padding:18px 16px 0 0}");
    }

    function create_fragment$1(ctx) {
    	let div;
    	let t_value = /*toDispString*/ ctx[2](/*$display*/ ctx[1]) + "";
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(t_value);
    			set_style(div, "font-size", /*fontSize*/ ctx[0]);
    			attr(div, "class", "svelte-1bwsk7c");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*$display*/ 2 && t_value !== (t_value = /*toDispString*/ ctx[2](/*$display*/ ctx[1]) + "")) set_data(t, t_value);

    			if (dirty & /*fontSize*/ 1) {
    				set_style(div, "font-size", /*fontSize*/ ctx[0]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    let maxDigits = 13; // how many digits can display show

    function instance$1($$self, $$props, $$invalidate) {
    	let $display;
    	component_subscribe($$self, display, $$value => $$invalidate(1, $display = $$value));
    	let rounded;
    	let fontSize = "3em";

    	const toDispString = val => {
    		if (val == 0) return "0";
    		let leftDigits = Math.max(Math.floor(Math.log10(val)), 0) + 1;

    		if (leftDigits > 10) {
    			return val.toExponential(8);
    		}

    		if (maxDigits > leftDigits) {
    			rounded = val.toFixed(maxDigits - leftDigits);
    		} else {
    			rounded = val;
    		}

    		let dispString = Number(rounded).toLocaleString("en-US", { maximumSignificantDigits: 12 });
    		let digits = dispString.split("").filter(digit => digit >= "0" && digit <= "9");
    		$$invalidate(0, fontSize = digits.length > 8 ? "2em" : "3em");
    		return dispString;
    	};

    	return [fontSize, $display, toDispString];
    }

    class Display extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {}, add_css$1);
    	}
    }

    /* Calculator.svelte generated by Svelte v3.46.4 */

    function add_css(target) {
    	append_styles(target, "svelte-ab085t", ".calc.svelte-ab085t{display:inline-grid;justify-content:center;grid-template-columns:62px 62px 62px 65px;grid-template-rows:78px repeat(5, 50px);margin:0 auto;gap:1px;background:#444}");
    }

    // (26:1) <Calcbtn use="fn" on:func = {setOperColor} >
    function create_default_slot_18(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("AC");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (27:1) <Calcbtn use="plusminus">
    function create_default_slot_17(ctx) {
    	let sup;
    	let t1;
    	let sub;

    	return {
    		c() {
    			sup = element("sup");
    			sup.textContent = "+";
    			t1 = text("/");
    			sub = element("sub");
    			sub.textContent = "−";
    		},
    		m(target, anchor) {
    			insert(target, sup, anchor);
    			insert(target, t1, anchor);
    			insert(target, sub, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(sup);
    			if (detaching) detach(t1);
    			if (detaching) detach(sub);
    		}
    	};
    }

    // (28:1) <Calcbtn use="fn">
    function create_default_slot_16(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("%");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (29:1) <Calcbtn use="oper" on:func = {setOperColor}>
    function create_default_slot_15(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("÷");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (30:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_14(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("7");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (31:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_13(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("8");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (32:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_12(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("9");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (33:1) <Calcbtn use="oper" on:func = {setOperColor}>
    function create_default_slot_11(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("×");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (34:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_10(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("4");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (35:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_9(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("5");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (36:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_8(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("6");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (37:1) <Calcbtn use="oper" on:func = {setOperColor}>
    function create_default_slot_7(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("−");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (38:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_6(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("1");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (39:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("2");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (40:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_4(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("3");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (41:1) <Calcbtn use="oper" on:func = {setOperColor}>
    function create_default_slot_3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("+");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (42:1) <Calcbtn width="twowide">
    function create_default_slot_2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("0");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (43:1) <Calcbtn on:ac = {setClear}>
    function create_default_slot_1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text(".");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (44:1) <Calcbtn use="oper" on:func = {setOperColor}>
    function create_default_slot(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let h1;
    	let t1;
    	let div;
    	let display;
    	let t2;
    	let calcbtn0;
    	let t3;
    	let calcbtn1;
    	let t4;
    	let calcbtn2;
    	let t5;
    	let calcbtn3;
    	let t6;
    	let calcbtn4;
    	let t7;
    	let calcbtn5;
    	let t8;
    	let calcbtn6;
    	let t9;
    	let calcbtn7;
    	let t10;
    	let calcbtn8;
    	let t11;
    	let calcbtn9;
    	let t12;
    	let calcbtn10;
    	let t13;
    	let calcbtn11;
    	let t14;
    	let calcbtn12;
    	let t15;
    	let calcbtn13;
    	let t16;
    	let calcbtn14;
    	let t17;
    	let calcbtn15;
    	let t18;
    	let calcbtn16;
    	let t19;
    	let calcbtn17;
    	let t20;
    	let calcbtn18;
    	let current;
    	display = new Display({});

    	calcbtn0 = new Calcbtn({
    			props: {
    				use: "fn",
    				$$slots: { default: [create_default_slot_18] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn0.$on("func", /*setOperColor*/ ctx[0]);

    	calcbtn1 = new Calcbtn({
    			props: {
    				use: "plusminus",
    				$$slots: { default: [create_default_slot_17] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn2 = new Calcbtn({
    			props: {
    				use: "fn",
    				$$slots: { default: [create_default_slot_16] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn3 = new Calcbtn({
    			props: {
    				use: "oper",
    				$$slots: { default: [create_default_slot_15] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn3.$on("func", /*setOperColor*/ ctx[0]);

    	calcbtn4 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_14] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn4.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn5 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_13] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn5.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn6 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_12] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn6.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn7 = new Calcbtn({
    			props: {
    				use: "oper",
    				$$slots: { default: [create_default_slot_11] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn7.$on("func", /*setOperColor*/ ctx[0]);

    	calcbtn8 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_10] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn8.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn9 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_9] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn9.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn10 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_8] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn10.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn11 = new Calcbtn({
    			props: {
    				use: "oper",
    				$$slots: { default: [create_default_slot_7] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn11.$on("func", /*setOperColor*/ ctx[0]);

    	calcbtn12 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_6] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn12.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn13 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_5] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn13.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn14 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_4] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn14.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn15 = new Calcbtn({
    			props: {
    				use: "oper",
    				$$slots: { default: [create_default_slot_3] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn15.$on("func", /*setOperColor*/ ctx[0]);

    	calcbtn16 = new Calcbtn({
    			props: {
    				width: "twowide",
    				$$slots: { default: [create_default_slot_2] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn17 = new Calcbtn({
    			props: {
    				$$slots: { default: [create_default_slot_1] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn17.$on("ac", /*setClear*/ ctx[1]);

    	calcbtn18 = new Calcbtn({
    			props: {
    				use: "oper",
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	calcbtn18.$on("func", /*setOperColor*/ ctx[0]);

    	return {
    		c() {
    			h1 = element("h1");
    			h1.textContent = "Calculator";
    			t1 = space();
    			div = element("div");
    			create_component(display.$$.fragment);
    			t2 = space();
    			create_component(calcbtn0.$$.fragment);
    			t3 = space();
    			create_component(calcbtn1.$$.fragment);
    			t4 = space();
    			create_component(calcbtn2.$$.fragment);
    			t5 = space();
    			create_component(calcbtn3.$$.fragment);
    			t6 = space();
    			create_component(calcbtn4.$$.fragment);
    			t7 = space();
    			create_component(calcbtn5.$$.fragment);
    			t8 = space();
    			create_component(calcbtn6.$$.fragment);
    			t9 = space();
    			create_component(calcbtn7.$$.fragment);
    			t10 = space();
    			create_component(calcbtn8.$$.fragment);
    			t11 = space();
    			create_component(calcbtn9.$$.fragment);
    			t12 = space();
    			create_component(calcbtn10.$$.fragment);
    			t13 = space();
    			create_component(calcbtn11.$$.fragment);
    			t14 = space();
    			create_component(calcbtn12.$$.fragment);
    			t15 = space();
    			create_component(calcbtn13.$$.fragment);
    			t16 = space();
    			create_component(calcbtn14.$$.fragment);
    			t17 = space();
    			create_component(calcbtn15.$$.fragment);
    			t18 = space();
    			create_component(calcbtn16.$$.fragment);
    			t19 = space();
    			create_component(calcbtn17.$$.fragment);
    			t20 = space();
    			create_component(calcbtn18.$$.fragment);
    			attr(div, "class", "calc svelte-ab085t");
    		},
    		m(target, anchor) {
    			insert(target, h1, anchor);
    			insert(target, t1, anchor);
    			insert(target, div, anchor);
    			mount_component(display, div, null);
    			append(div, t2);
    			mount_component(calcbtn0, div, null);
    			append(div, t3);
    			mount_component(calcbtn1, div, null);
    			append(div, t4);
    			mount_component(calcbtn2, div, null);
    			append(div, t5);
    			mount_component(calcbtn3, div, null);
    			append(div, t6);
    			mount_component(calcbtn4, div, null);
    			append(div, t7);
    			mount_component(calcbtn5, div, null);
    			append(div, t8);
    			mount_component(calcbtn6, div, null);
    			append(div, t9);
    			mount_component(calcbtn7, div, null);
    			append(div, t10);
    			mount_component(calcbtn8, div, null);
    			append(div, t11);
    			mount_component(calcbtn9, div, null);
    			append(div, t12);
    			mount_component(calcbtn10, div, null);
    			append(div, t13);
    			mount_component(calcbtn11, div, null);
    			append(div, t14);
    			mount_component(calcbtn12, div, null);
    			append(div, t15);
    			mount_component(calcbtn13, div, null);
    			append(div, t16);
    			mount_component(calcbtn14, div, null);
    			append(div, t17);
    			mount_component(calcbtn15, div, null);
    			append(div, t18);
    			mount_component(calcbtn16, div, null);
    			append(div, t19);
    			mount_component(calcbtn17, div, null);
    			append(div, t20);
    			mount_component(calcbtn18, div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const calcbtn0_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn0_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn0.$set(calcbtn0_changes);
    			const calcbtn1_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn1_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn1.$set(calcbtn1_changes);
    			const calcbtn2_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn2_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn2.$set(calcbtn2_changes);
    			const calcbtn3_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn3_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn3.$set(calcbtn3_changes);
    			const calcbtn4_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn4_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn4.$set(calcbtn4_changes);
    			const calcbtn5_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn5_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn5.$set(calcbtn5_changes);
    			const calcbtn6_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn6_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn6.$set(calcbtn6_changes);
    			const calcbtn7_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn7_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn7.$set(calcbtn7_changes);
    			const calcbtn8_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn8_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn8.$set(calcbtn8_changes);
    			const calcbtn9_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn9_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn9.$set(calcbtn9_changes);
    			const calcbtn10_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn10_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn10.$set(calcbtn10_changes);
    			const calcbtn11_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn11_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn11.$set(calcbtn11_changes);
    			const calcbtn12_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn12_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn12.$set(calcbtn12_changes);
    			const calcbtn13_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn13_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn13.$set(calcbtn13_changes);
    			const calcbtn14_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn14_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn14.$set(calcbtn14_changes);
    			const calcbtn15_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn15_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn15.$set(calcbtn15_changes);
    			const calcbtn16_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn16_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn16.$set(calcbtn16_changes);
    			const calcbtn17_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn17_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn17.$set(calcbtn17_changes);
    			const calcbtn18_changes = {};

    			if (dirty & /*$$scope*/ 4) {
    				calcbtn18_changes.$$scope = { dirty, ctx };
    			}

    			calcbtn18.$set(calcbtn18_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(display.$$.fragment, local);
    			transition_in(calcbtn0.$$.fragment, local);
    			transition_in(calcbtn1.$$.fragment, local);
    			transition_in(calcbtn2.$$.fragment, local);
    			transition_in(calcbtn3.$$.fragment, local);
    			transition_in(calcbtn4.$$.fragment, local);
    			transition_in(calcbtn5.$$.fragment, local);
    			transition_in(calcbtn6.$$.fragment, local);
    			transition_in(calcbtn7.$$.fragment, local);
    			transition_in(calcbtn8.$$.fragment, local);
    			transition_in(calcbtn9.$$.fragment, local);
    			transition_in(calcbtn10.$$.fragment, local);
    			transition_in(calcbtn11.$$.fragment, local);
    			transition_in(calcbtn12.$$.fragment, local);
    			transition_in(calcbtn13.$$.fragment, local);
    			transition_in(calcbtn14.$$.fragment, local);
    			transition_in(calcbtn15.$$.fragment, local);
    			transition_in(calcbtn16.$$.fragment, local);
    			transition_in(calcbtn17.$$.fragment, local);
    			transition_in(calcbtn18.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(display.$$.fragment, local);
    			transition_out(calcbtn0.$$.fragment, local);
    			transition_out(calcbtn1.$$.fragment, local);
    			transition_out(calcbtn2.$$.fragment, local);
    			transition_out(calcbtn3.$$.fragment, local);
    			transition_out(calcbtn4.$$.fragment, local);
    			transition_out(calcbtn5.$$.fragment, local);
    			transition_out(calcbtn6.$$.fragment, local);
    			transition_out(calcbtn7.$$.fragment, local);
    			transition_out(calcbtn8.$$.fragment, local);
    			transition_out(calcbtn9.$$.fragment, local);
    			transition_out(calcbtn10.$$.fragment, local);
    			transition_out(calcbtn11.$$.fragment, local);
    			transition_out(calcbtn12.$$.fragment, local);
    			transition_out(calcbtn13.$$.fragment, local);
    			transition_out(calcbtn14.$$.fragment, local);
    			transition_out(calcbtn15.$$.fragment, local);
    			transition_out(calcbtn16.$$.fragment, local);
    			transition_out(calcbtn17.$$.fragment, local);
    			transition_out(calcbtn18.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(h1);
    			if (detaching) detach(t1);
    			if (detaching) detach(div);
    			destroy_component(display);
    			destroy_component(calcbtn0);
    			destroy_component(calcbtn1);
    			destroy_component(calcbtn2);
    			destroy_component(calcbtn3);
    			destroy_component(calcbtn4);
    			destroy_component(calcbtn5);
    			destroy_component(calcbtn6);
    			destroy_component(calcbtn7);
    			destroy_component(calcbtn8);
    			destroy_component(calcbtn9);
    			destroy_component(calcbtn10);
    			destroy_component(calcbtn11);
    			destroy_component(calcbtn12);
    			destroy_component(calcbtn13);
    			destroy_component(calcbtn14);
    			destroy_component(calcbtn15);
    			destroy_component(calcbtn16);
    			destroy_component(calcbtn17);
    			destroy_component(calcbtn18);
    		}
    	};
    }

    function instance($$self) {
    	const setOperColor = event => {
    		let selected = event.detail.symbol;
    		if (selected === "=") selected = "";
    		let opers = document.getElementsByClassName("oper");

    		for (var i = 0, length = opers.length; i < length; i++) {
    			opers[i].style.backgroundColor = "#F94";

    			if (opers[i].innerHTML === selected) {
    				opers[i].style.backgroundColor = "#c72";
    			}
    		}
    	};

    	const setClear = event => {
    		event.detail.symbol;
    		let opers = document.getElementsByClassName("fn");
    		opers[0].innerHTML = "C";
    	};

    	return [setOperColor, setClear];
    }

    class Calculator extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {}, add_css);
    	}
    }

    //import Embed from "./Embed.svelte";

    var div = document.createElement("DIV");
    var script = document.currentScript;
    script.parentNode.insertBefore(div, script);

    new Calculator({
      target: div,
      //   props: { name: "Svelte component" },
    });

})();
