use std::{collections::HashMap, sync::Arc};

use codewide_companion::{
    catalog::SessionCatalog, files::FileService, resources::ResourceService, store::IndexStore,
};

#[test]
fn corrupt_operational_index_fails_closed_without_touching_canonical_history()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("state.redb");
    {
        let _store = IndexStore::open(&path)?;
    }
    std::fs::write(&path, b"not a redb database")?;
    assert!(IndexStore::open(&path).is_err());
    Ok(())
}

#[tokio::test]
async fn corrupt_derived_resource_index_is_quarantined_and_rebuilt()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("resources.redb");
    std::fs::write(&path, b"not a redb database")?;
    let files = Arc::new(FileService::open(HashMap::new(), Vec::new(), None, None).await?);
    let _service = ResourceService::open(
        &path,
        Arc::new(SessionCatalog::scan(directory.path())),
        Arc::new(IndexStore::open(directory.path().join("index.redb"))?),
        files,
    )?;
    assert!(path.is_file());
    let backups = std::fs::read_dir(directory.path())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("resources.redb.corrupt.")
        })
        .count();
    assert_eq!(backups, 1);
    Ok(())
}
