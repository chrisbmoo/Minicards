/* Static-site helpers for minicards.com.au (replaces WordPress-only features). */
(function () {
  // Web3Forms access key for the contact form. Create one free at https://web3forms.com
  // using the email address that should receive enquiries, then paste it here.
  var WEB3FORMS_KEY = "YOUR_WEB3FORMS_ACCESS_KEY";
  var FALLBACK_EMAIL = "melb@minicards.com.au";

  document.addEventListener("submit", function (e) {
    var form = e.target;

    // 1. Site search -> Google search limited to this site
    var s = form.querySelector('input[name="s"]');
    if (s) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var q = (s.value || "").trim();
      window.location.href = "https://www.google.com/search?q=" +
        encodeURIComponent("site:minicards.com.au " + q);
      return;
    }

    // 2. Contact form -> Web3Forms (or email fallback until a key is set)
    if (form.classList.contains("elementor-form")) {
      e.stopImmediatePropagation(); // keep Elementor's WordPress handler out of it
      if (WEB3FORMS_KEY.indexOf("YOUR_") === 0) {
        e.preventDefault();
        var get = function (n) {
          var el = form.querySelector('[name="' + n + '"]:checked') || form.querySelector('[name="' + n + '"]');
          return el ? el.value : "";
        };
        var body = "Name: " + get("name") + "\nPhone: " + get("phone") + "\nEmail: " + get("email") +
          "\nEnquiring about: " + get("enquiry") + "\n\n" + get("message");
        window.location.href = "mailto:" + FALLBACK_EMAIL + "?subject=" +
          encodeURIComponent("Website enquiry") + "&body=" + encodeURIComponent(body);
        return;
      }
      form.querySelector('input[name="access_key"]').value = WEB3FORMS_KEY;
      // let the browser submit the form normally to Web3Forms
    }
  }, true);
})();
