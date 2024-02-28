import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
//aws amplify storage
// import { Storage } from '@aws-amplify/storage';

// import { uploadData } from 'aws-amplify/storage';
// Context
import { AppContext } from '../App';

// Router
import { useLocation } from 'react-router-dom';

// Cloudscape
import { useCollection } from '@cloudscape-design/collection-hooks';
import { Button, Pagination, Table, TextFilter } from '@cloudscape-design/components';
import ProgressBar from '@cloudscape-design/components/progress-bar';
// App
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { columnDefs } from './tableColumnDefs';
import { DEFAULT_PREFERENCES } from './tablePrefs';
import { searchImageSets } from '../../utils/AwsHealthImagingApi';
import { TableHeader, TablePreferences } from './SearchTableComponents';
import TableEmptyState from '../../common/Table/TableEmptyState';

//cloudscape file upload package
import FileUpload from '@cloudscape-design/components/file-upload';
import FormField from '@cloudscape-design/components/form-field';

import './search.css';

// Configure AWS Amplify
import { Amplify } from 'aws-amplify';
import awsExports from '../../aws-exports';

import { Storage } from 'aws-amplify';

import axios from 'axios';

Amplify.configure({
    Auth: {
        identityPoolId: 'us-west-2:1fd67970-29aa-4ea4-97cd-12dc377e66b0', //REQUIRED - Amazon Cognito Identity Pool ID
        region: 'us-west-2', // REQUIRED - Amazon Cognito Region
        userPoolId: 'us-west-2_bEKqkurBi', //OPTIONAL - Amazon Cognito User Pool ID
        userPoolWebClientId: '216cjja3a91m44j1n2jkl8pbn', //OPTIONAL - Amazon Cognito Web Client ID
    },
    Storage: {
        bucket: 'sll-dicom-store', //REQUIRED -  Amazon S3 bucket
        region: 'us-west-2', //OPTIONAL -  Amazon service region
    },
});

export default function Upload() {
    // for file upload value store
    const [value, setValue] = useState([]);
    const [processing, setProcessing] = useState(0);
    const [visibleProcessing, setVisibleProcessing] = useState(false);

    const { buildCrumb, addFlashMessage } = useContext(AppContext);
    const location = useLocation();

    const [selectedDatastore, setSelectedDatastore] = useState(null); // selected datastore OBJECT from <Select />
    const [tableLoading, setTableLoading] = useState(false);
    const [imageSets, setImageSets] = useState([]); // ImageSets returned from search
    const [moreImageSets, setMoreImageSets] = useState({}); // are there more imagesets (nextToken returned)?
    const [selectedImageSet, setSelectedImageSet] = useState([]); // single selected ImageSet
    const [preferences, setPreferences] = useLocalStorage('Search-Preferences', DEFAULT_PREFERENCES);

    // Disable ImageSet action buttons (view metadata, view images) if nothing is selected
    const actionButtonDisabled = useMemo(() => selectedImageSet.length === 0, [selectedImageSet.length]);

    // Header counter text
    const headerCounterText = `(${imageSets.length}${Object.keys(moreImageSets).length > 0 ? '+' : ''})`;

    // Set crumbs
    useEffect(() => {
        buildCrumb(location.pathname, 'Upload');
    }, [buildCrumb, location]);

    // Search studies using nativeSearch()
    const searchImageSetsWrapper = useCallback(
        async (searchFilter, nextToken = null) => {
            setTableLoading(true);

            try {
                // Build search params
                var searchParams = {
                    datastoreId: selectedDatastore?.value,
                    data: searchFilter,
                };
                // Add nextToken to search params if specified
                if (nextToken != null) {
                    searchParams = { ...searchParams, nextToken: nextToken };
                }
                const searchResults = await searchImageSets(searchParams);

                // Handle undefined imageSetsMetadataSummaries (the service should return an empty array)
                if (typeof searchResults.data?.imageSetsMetadataSummaries === 'undefined') {
                    setImageSets([]);
                    setTableLoading(false);
                    return;
                }

                // Results from the search API has DICOM properties in the "DICOMTag" key - need to move everything up
                let imageSetResults = searchResults.data?.imageSetsMetadataSummaries;
                const flatImageSetResults = imageSetResults.map((r) => {
                    let { DICOMTags: _, ...flatObj } = r;
                    flatObj = { ...flatObj, ...r.DICOMTags };
                    return flatObj;
                });

                // if nextToken is specified, append search results to existing results
                if (nextToken != null) {
                    setImageSets((prevImageSets) => prevImageSets.concat(flatImageSetResults));
                } else {
                    setImageSets(flatImageSetResults || []);
                }
                // If the search returned nextToken, there are additional results.
                // Encode nextToken
                if (searchResults.data?.nextToken) {
                    const encodedNextToken = encodeURIComponent(searchResults.data?.nextToken);
                    setMoreImageSets({
                        searchFilter: searchFilter,
                        nextToken: encodedNextToken,
                    });
                } else {
                    setMoreImageSets({});
                }
            } catch (e) {
                setTableLoading(false);
                addFlashMessage({
                    header: 'Upload',
                    content: e.toString(),
                    type: 'error',
                });
            }
            setTableLoading(false);
        },
        [addFlashMessage, selectedDatastore]
    );

    // Table collection
    const { items, actions, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(
        imageSets,
        {
            filtering: {
                empty: (
                    <TableEmptyState
                        title="No ImageSets"
                        subtitle="Try selecting another datastore or clearing the search filter."
                    />
                ),
                noMatch: (
                    <TableEmptyState
                        title="No matches"
                        subtitle="We cannot find a match."
                        action={<Button onClick={() => actions.setFiltering('')}>Clear filter</Button>}
                    />
                ),
            },
            pagination: { pageSize: preferences.pageSize },
            sorting: {},
            selection: {},
        }
    );

    // Property for <Pagination /> to enable ... on navigation if there are additional imageSets
    const openEndPaginationProp = useMemo(() => {
        if (Object.keys(moreImageSets).length > 0) {
            return { openEnd: true };
        } else {
            return {};
        }
    }, [moreImageSets]);

    const uploadFile = () => {
        try {
            value.map((file) => {
                const type = file.type;
                const name = file.name;

                Storage.put(`upload/${name}`, file, {
                    contentType: type,
                    progressCallback(progress) {
                        const percentUploaded = Math.round((progress.loaded / progress.total) * 100);
                        setProcessing(percentUploaded);

                        console.log(`Uploaded: ${progress.loaded}/${progress.total}`);
                    },
                });
            });
            setVisibleProcessing(true);
        } catch (error) {
            console.log('Error uploading file: ', error);
        }
    };


    

    return (
        <>
            <Table
                // {...collectionProps}
                variant="full-page"
                header={
                    <TableHeader
                        selectedDatastore={selectedDatastore}
                        setSelectedDatastore={setSelectedDatastore}
                        selectedImageSet={selectedImageSet}
                        actionButtonDisabled={actionButtonDisabled}
                        headerCounterText={headerCounterText}
                        searchImageSets={searchImageSetsWrapper}
                    />
                }
                stickyHeader={true}
                columnDefinitions={columnDefs}
                // visibleColumns={preferences.visibleContent}
                // items={items}
                // trackBy={'imageSetId'}
                // loading={tableLoading}
                // loadText={'Loading ImageSets'}
                // pagination={
                //     <Pagination
                //         {...openEndPaginationProp}
                //         {...paginationProps}
                //         onChange={(event) => {
                //             if (event.detail?.currentPageIndex > paginationProps.pagesCount) {
                //                 searchImageSetsWrapper(moreImageSets.searchFilter, moreImageSets.nextToken);
                //             }
                //             paginationProps.onChange(event);
                //         }}
                //     />
                // }
                // filter={
                //     <TextFilter
                //         {...filterProps}
                //         disabled={imageSets.length === 0}
                //         countText={`${filteredItemsCount} matches`}
                //     />
                // }
                //    preferences={<TablePreferences preferences={preferences} setPreferences={setPreferences} />}
                //  selectionType="single"
                //    onSelectionChange={({ detail }) => setSelectedImageSet(detail.selectedItems)}
                // selectedItems={selectedImageSet}
                // resizableColumns={true}
                //  wrapLines={preferences.wrapLines}
                //stripedRows={preferences.stripedRows}
            />
            <FormField label="Upload dicom files" description="upload to s3">
                <FileUpload
                    onChange={({ detail }) => setValue(detail.value)}
                    value={value}
                    i18nStrings={{
                        uploadButtonText: (e) => (e ? 'Choose files' : 'Choose file'),
                        dropzoneText: (e) => (e ? 'Drop files to upload' : 'Drop file to upload'),
                        removeFileAriaLabel: (e) => `Remove file ${e + 1}`,
                        limitShowFewer: 'Show fewer files',
                        limitShowMore: 'Show more files',
                        errorIconAriaLabel: 'Error',
                    }}
                    multiple
                    showFileLastModified
                    showFileSize
                    showFileThumbnail
                    tokenLimit={3}
                    // constraintText="Hint text for file requirements"
                />
            </FormField>
            <br></br>

            {/* <p>Upload Progress: {processing}%</p> */}

            {visibleProcessing ? (
                <>
                    <ProgressBar value={processing} label="processing" />
                    <br></br>
                </>
            ) : (
                ''
            )}

            <Button variant="primary" type="submit" onClick={uploadFile}>
                Upload
            </Button>
        </>
    );
}
