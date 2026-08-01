var crypto   = require('crypto')
  , CryptoJS = require('crypto-js');

module.exports = {
  encrypt : function(obj) {
    if (typeof obj === 'object') {
      obj = JSON.stringify(obj);
    }

    var token     = crypto.randomBytes(16).toString('hex');
    var encrypted = CryptoJS.AES.encrypt(obj, token).toString();

    // Preserved quirk: the AES key is shipped to the browser alongside the ciphertext and split apart in
    // public/js/trinket-roles.js. Obfuscation, not security. See docs/PRESERVED-QUIRKS.md section 1.9.
    return token + '+' + encrypted;
  }
}
