//! Short visual authentication: commit before either peer learns both nonces.
use super::ChannelBinding;
use crate::{Result, denied};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

// Fixed wire-version alphabet: four independent six-bit symbols. Short English
// names also work when an SSH terminal has no emoji font or a screen reader.
const SYMBOLS: [(&str, &str); 64] = [
    ("🐶", "Dog"),
    ("🐱", "Cat"),
    ("🦁", "Lion"),
    ("🐴", "Horse"),
    ("🐼", "Panda"),
    ("🐨", "Koala"),
    ("🐯", "Tiger"),
    ("🐷", "Pig"),
    ("🐸", "Frog"),
    ("🐭", "Mouse"),
    ("🐰", "Rabbit"),
    ("🦊", "Fox"),
    ("🐻", "Bear"),
    ("🐮", "Cow"),
    ("🐵", "Monkey"),
    ("🐥", "Chick"),
    ("🦉", "Owl"),
    ("🦆", "Duck"),
    ("🦅", "Eagle"),
    ("🦇", "Bat"),
    ("🐳", "Whale"),
    ("🐟", "Fish"),
    ("🦀", "Crab"),
    ("🐌", "Snail"),
    ("🐝", "Bee"),
    ("🐞", "Bug"),
    ("🐍", "Snake"),
    ("🐢", "Turtle"),
    ("🦖", "Dino"),
    ("🦈", "Shark"),
    ("🦐", "Prawn"),
    ("🦑", "Squid"),
    ("🍎", "Apple"),
    ("🍋", "Lemon"),
    ("🍉", "Melon"),
    ("🍒", "Cherry"),
    ("🍌", "Banana"),
    ("🍇", "Grape"),
    ("🍑", "Peach"),
    ("🍐", "Pear"),
    ("🥝", "Kiwi"),
    ("🌽", "Corn"),
    ("🥕", "Carrot"),
    ("🎂", "Cake"),
    ("🍕", "Pizza"),
    ("🍩", "Donut"),
    ("🍪", "Cookie"),
    ("🍞", "Bread"),
    ("🚀", "Rocket"),
    ("🎸", "Guitar"),
    ("🔔", "Bell"),
    ("📕", "Book"),
    ("🎁", "Gift"),
    ("🔑", "Key"),
    ("🔒", "Lock"),
    ("💡", "Lamp"),
    ("👑", "Crown"),
    ("🎩", "Hat"),
    ("⚽", "Ball"),
    ("🚂", "Train"),
    ("🚲", "Bike"),
    ("⚓", "Anchor"),
    ("🌲", "Tree"),
    ("🌙", "Moon"),
];

pub(crate) fn commitment(binding: &ChannelBinding, nonce: &[u8; 32]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"codewide-enrollment-commit-v1\0");
    hash.update(binding.0);
    hash.update(nonce);
    hash.finalize().into()
}

pub(crate) fn verify(
    binding: &ChannelBinding,
    nonce: &[u8; 32],
    expected: &[u8; 32],
) -> Result<()> {
    if bool::from(commitment(binding, nonce).ct_eq(expected)) {
        Ok(())
    } else {
        Err(denied())
    }
}

pub(crate) fn decode(value: &str) -> Result<[u8; 32]> {
    let mut bytes = [0; 32];
    hex::decode_to_slice(value, &mut bytes)?;
    Ok(bytes)
}

pub(crate) fn code(
    binding: &ChannelBinding,
    client_nonce: &[u8; 32],
    server_nonce: &[u8; 32],
) -> String {
    let mut hash = Sha256::new();
    hash.update(b"codewide-enrollment-symbols-v1\0");
    hash.update(binding.0);
    hash.update(client_nonce);
    hash.update(server_nonce);
    let digest = hash.finalize();
    let indices = [
        digest[0] >> 2,
        ((digest[0] & 3) << 4) | (digest[1] >> 4),
        ((digest[1] & 15) << 2) | (digest[2] >> 6),
        digest[2] & 63,
    ];
    let symbols = indices.map(|index| SYMBOLS[usize::from(index)]);
    format!(
        "{}\n{}",
        symbols.map(|symbol| symbol.0).join("  "),
        symbols.map(|symbol| symbol.1).join(" · "),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commitment_binds_the_nonce_to_this_tls_channel() {
        let binding = ChannelBinding([1; 32]);
        let nonce = [2; 32];
        let expected = commitment(&binding, &nonce);
        assert!(verify(&binding, &nonce, &expected).is_ok());
        assert!(verify(&ChannelBinding([3; 32]), &nonce, &expected).is_err());
        assert!(verify(&binding, &[3; 32], &expected).is_err());
        assert!(decode("00").is_err());
        assert_ne!(
            code(&binding, &nonce, &[4; 32]),
            code(&binding, &nonce, &[5; 32])
        );
    }

    #[test]
    fn symbols_have_unique_short_accessible_names() {
        let mut emoji = std::collections::HashSet::new();
        let mut names = std::collections::HashSet::new();
        for (symbol, name) in SYMBOLS {
            assert!(emoji.insert(symbol));
            assert!(names.insert(name));
            assert!(name.len() <= 6);
        }
    }
}
