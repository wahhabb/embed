<script context="module">
	let lastBtn = '';
	let lastOper = '';
	let operand = '';
	let inDecimal = 0;
</script>

<script>
	export let width = '';
	export let use = 'number';
	import { display } from './stores.js';
	import { createEventDispatcher } from 'svelte';
	const dispatch = createEventDispatcher();

	let calcClick = (a) => {
		const btn = a.target.innerHTML;
		if (use == 'plusminus') {
			// +/- key
			display.set(-$display);
			return 0;
		}
		if (btn == '%') {
			display.set($display / 100);
			return 0;
		}
		if ('0' <= btn && btn <= '9') {
			dispatch('ac', {
				symbol: btn
			});
			if (lastBtn != 'number') {
				display.set(0);
			}
			if (inDecimal == 1) {
				display.set(Number(String($display) + '.' + btn));
				++inDecimal;
			} else {
				if (inDecimal) {
					display.set(Number(String($display) + btn));
					++inDecimal;
				} else {
					display.set($display * 10 + Number(btn));
				}
			}
			lastBtn = 'number';
		} else {
			switch (btn) {
				case '.':
					if (inDecimal == 0) {
						inDecimal = 1;
						if (lastBtn === 'operator') {
							lastBtn = 'number';
							display.set(0);
						}
					}
					break;
				case 'AC':
					dispatch('func', {
						symbol: btn
					});
					lastOper = ''; // fall through!
				case 'C':
					display.set(0);
					lastBtn = 'number';
					a.target.innerHTML = 'AC';
					inDecimal = 0;
					break;
				case '+':
				case '\u2212': // Minus
				case '\u00D7': // Multiply
				case '\u00F7': // Divide
				case '=':
					dispatch('func', {
						symbol: btn
					});
					a.target.classList.add('hold');
					switch (lastOper) {
						case '':
							operand = $display;
							break;
						case '+':
							operand += $display;
							break;
						case '\u2212': // Minus
							operand -= $display;
							break;
						case '\u00D7': // Multiply
							operand *= $display;
							break;
						case '\u00F7': // Divide
							operand /= $display;
							break;
					}
					display.set(operand);
					lastBtn = 'operator';
					lastOper = btn;
					inDecimal = 0;
					if (btn === '=') {
						lastOper = '';
						operand = 0;
					}
					break;
			}
		}
	};
</script>

<button class="{width} {use}" on:click={(a) => calcClick(a)}>
	<slot />
</button>

<style>
	button {
		background: #777;
		height: 100%;
		color: white;
		font-size: 140%;
		font-weight: 200;
		border: none;
		margin: 0;
	}
	button:active {
		background: #aaa;
	}
	.twowide {
		grid-column-end: span 2;
		text-align: left;
		padding-left: 1.3em;
	}
	.oper {
		background: #f94;
		font-size: 180%;
		padding-top: 0.31em;
	}
	.oper.held {
		background: #c72;
	}
	.fn,
	.plusminus {
		background: #555;
	}
	button.oper:active {
		background: #c72;
	}
	button.fn:active,
	button.plusminus:active {
		background: #777;
	}
</style>
