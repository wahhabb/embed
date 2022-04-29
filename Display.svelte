<script>
	import { display } from './stores.js';
	let rounded;
	let fontSize = '3.2em';
	let maxDigits = 13; // how many digits can display show
	const toDispString = (val) => {
		if (val == 0) return '0';
		let leftDigits = Math.max(Math.floor(Math.log10(val)), 0) + 1;
		if (leftDigits > 10) {
			return val.toExponential(8);
		}
		if (maxDigits > leftDigits) {
			rounded = val.toFixed(maxDigits - leftDigits);
		} else {
			rounded = val;
		}
		let dispString = Number(rounded).toLocaleString('en-US', { maximumSignificantDigits: 12 });
		let digits = dispString.split('').filter((digit) => digit >= '0' && digit <= '9');
		fontSize = digits.length > 8 ? '2.1em' : '3.2em';
		return dispString;
	};
</script>

<div style="font-size: {fontSize}">
	{toDispString($display)}
</div>

<style>
	div {
		grid-column-start: 1;
		grid-column-end: 5;
		background-color: #444;
		color: white;
		font-weight: 100;
		text-align: right;
		align-self: end;
		padding: 0 var(--fontSize) 0 0;
	}
</style>
