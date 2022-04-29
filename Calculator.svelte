<script>
	import Calcbtn from './Calcbtn.svelte';
	import Display from './Display.svelte';
	export let calcFontSize = '16px';
	let calc;

	const setOperColor = (event) => {
		let selected = event.detail.symbol;
		if (selected === '=') selected = '';
		let opers = calc.getElementsByClassName('oper');
		for (var i = 0, length = opers.length; i < length; i++) {
			opers[i].classList.remove('held');
			if (opers[i].innerHTML === selected) {
				opers[i].classList.add('held');
			}
		}
	};
	const setClear = (event) => {
		let selected = event.detail.symbol;
		let opers = document.getElementsByClassName('fn');
		opers[0].innerHTML = 'C';
	};
</script>

<div class="calc" style="--fontSize:{calcFontSize};" bind:this={calc}>
	<Display />
	<Calcbtn use="fn" on:func={setOperColor}>AC</Calcbtn>
	<Calcbtn use="plusminus"><sup>&plus;</sup>/<sub>&minus;</sub></Calcbtn>
	<Calcbtn use="fn">%</Calcbtn>
	<Calcbtn use="oper" on:func={setOperColor}>&div;</Calcbtn>
	<Calcbtn on:ac={setClear}>7</Calcbtn>
	<Calcbtn on:ac={setClear}>8</Calcbtn>
	<Calcbtn on:ac={setClear}>9</Calcbtn>
	<Calcbtn use="oper" on:func={setOperColor}>&times;</Calcbtn>
	<Calcbtn on:ac={setClear}>4</Calcbtn>
	<Calcbtn on:ac={setClear}>5</Calcbtn>
	<Calcbtn on:ac={setClear}>6</Calcbtn>
	<Calcbtn use="oper" on:func={setOperColor}>&minus;</Calcbtn>
	<Calcbtn on:ac={setClear}>1</Calcbtn>
	<Calcbtn on:ac={setClear}>2</Calcbtn>
	<Calcbtn on:ac={setClear}>3</Calcbtn>
	<Calcbtn use="oper" on:func={setOperColor}>+</Calcbtn>
	<Calcbtn width="twowide">0</Calcbtn>
	<Calcbtn on:ac={setClear}>.</Calcbtn>
	<Calcbtn use="oper" on:func={setOperColor}>=</Calcbtn>
</div>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Work+Sans:wght@200&display=swap');
	.calc {
		font-size: var(--fontSize);
		display: inline-grid;
		justify-content: center;
		grid-template-columns: repeat(3, 3.875em) 4.06em;
		grid-template-rows: 5em repeat(5, 3.125em);
		margin: 0 auto;
		gap: 0.125em;
		background: #444;
		font-family: 'Work Sans', sans-serif;
	}
</style>
