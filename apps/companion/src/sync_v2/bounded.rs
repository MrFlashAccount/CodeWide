//! Small insertion-ordered retention map for non-durable source witnesses.

use std::{
    collections::{HashMap, VecDeque},
    hash::Hash,
};

pub struct BoundedMap<K, V> {
    limit: usize,
    values: HashMap<K, V>,
    order: VecDeque<K>,
}

impl<K: Clone + Eq + Hash, V> BoundedMap<K, V> {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            values: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.values.get(key)
    }

    pub fn insert(&mut self, key: K, value: V) -> Option<(K, V)> {
        if self.values.contains_key(&key) {
            self.order.retain(|candidate| candidate != &key);
        }
        self.values.insert(key.clone(), value);
        self.order.push_back(key);
        let mut evicted = None;
        while self.values.len() > self.limit {
            if let Some(oldest) = self.order.pop_front()
                && let Some(value) = self.values.remove(&oldest)
            {
                evicted = Some((oldest, value));
            }
        }
        evicted
    }

    pub fn retain(&mut self, mut keep: impl FnMut(&K, &V) -> bool) {
        self.values.retain(|key, value| keep(key, value));
        self.order.retain(|key| self.values.contains_key(key));
    }

    pub fn clear(&mut self) {
        self.values.clear();
        self.order.clear();
    }

    pub fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.values.iter()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.values.len()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn evicts_oldest_entry_at_the_boundary() {
        let mut map = super::BoundedMap::new(2);
        assert_eq!(map.insert("a", 1), None);
        assert_eq!(map.insert("b", 2), None);
        assert_eq!(map.insert("c", 3), Some(("a", 1)));
        assert_eq!(map.len(), 2);
        assert!(map.get(&"a").is_none());
        assert_eq!(map.get(&"c"), Some(&3));
    }
}
