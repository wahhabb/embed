<script>
    export let name; // from props
    import Words from './Words.svelte';
</script>
    
    <h1>Hello, {name}!</h1>
    <Words />
    
    <p>This component was brought to you by <a href="https://codeandlife.com/">Code
      &amp; Life</a>.</p>

 <style>

     p {
         color: red;
     }
 </style>     
    