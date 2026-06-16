# Website Button Snippet

Use this file on `www.sunilgotame.com.np` to show the `Create Stat` button on the top-right side of the website:

```html
<script>
  window.STATEMENT_GENERATOR_URL = "https://www.sunilgotame.com.np/statement-generator/";
</script>
<script src="/statement-generator/site_integration/create_stat_button.js"></script>
```

If you host the statement app on another path or subdomain, update `window.STATEMENT_GENERATOR_URL` first.
