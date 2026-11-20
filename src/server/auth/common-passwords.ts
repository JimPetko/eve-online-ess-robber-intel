/**
 * The 100 most common passwords of 12 or more characters, lowercased: shorter ones already fail the
 * minimum length. Taken in rank order from SecLists' 100k-most-used-passwords-NCSC.txt, keeping only
 * those also in xato-net-10-million-passwords-100000.txt, which drops one-site noise.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "q1w2e3r4t5y6", "1qaz2wsx3edc", "1q2w3e4r5t6y", "sojdlg123aljg", "qwerty123456", "123qweasdzxc",
  "polniypizdec0211", "123456qwerty", "123456654321", "123456123456", "qazwsxedcrfv", "polniypizdec110211",
  "qwertyqwerty", "123456789123", "112233445566", "justinbieber", "123456789987654321", "qweasdzxc123",
  "motherfucker", "123456789123456789", "qazwsxedc123", "international", "password1234", "temppassword",
  "polniypizdec1102", "professional", "qwerasdfzxcv", "qwertyuiop123", "leavemealone", "123456789abc",
  "administrator", "finalfantasy", "123qwe123qwe", "zxcasdqwe123", "123456789qwe", "sonyericsson",
  "asdfghjkl123", "jamesbond007", "playstation3", "1qazxsw23edc", "123123123123", "123321123321",
  "111111111111", "123456789asd", "010203040506", "transformers", "gfhjkmgfhjkm", "supernatural",
  "sonnenschein", "12345678900987654321", "qwertyuiop12", "needforspeed", "1qaz2wsx3edc4rfv", "peanutbutter",
  "1234567891011", "lovelovelove", "123456789123456", "102030405060", "combat123654", "playstation2",
  "ingodwetrust", "qwertyasdfgh", "12345678901234567890", "abc123456789", "ghhh47hj7649", "christopher1",
  "1234567890qwertyuiop", "avrillavigne", "ilovemyfamily", "qwertyytrewq", "counterstrike", "jesuslovesme",
  "159753159753", "stratocaster", "123456789qwerty", "qazwsxedcrfvtgb", "qazxswedcvfr", "123456789qaz",
  "q1w2e3r4t5y6u7i8o9p0", "123456789101112", "000000000000", "1234567890123", "qwerty123456789",
  "ghbdtnrfrltkf", "12345678987654321", "111111111111111", "cosmopolitan", "edwardcullen", "michaeljackson",
  "zaq1xsw2cde3", "qwe123qwe123", "123456789000", "1234567890qwe", "manchesterunited", "1234567890987654321",
  "123456789zxc", "ghjcnjgfhjkm", "residentevil", "minecraft123", "12345677654321",
]);
