import axios from 'axios';

const axiosClient = axios.create({
    baseURL: 'https://api.example.com',
    timeout: 10000, // 10 seconds timeout
});

// Request interceptors for logging
axiosClient.interceptors.request.use(request => {
    console.log('Starting Request', request);
    return request;
});

// Response interceptors for logging
axiosClient.interceptors.response.use(response => {
    console.log('Response:', response);
    return response;
}, error => {
    console.error('Response error:', error);
    return Promise.reject(error);
});

// Retry logic
const retryRequest = (fn, retriesLeft = 3, interval = 1000) => {
    return fn().catch((error) => {
        if (retriesLeft === 1) throw error;
        return new Promise(resolve => setTimeout(resolve, interval)).then(() => 
            retryRequest(fn, retriesLeft - 1, interval)
        );
    });
};

// Usage example
const fetchData = () => {
    return axiosClient.get('/data');
};

retryRequest(fetchData)
    .then(data => console.log('Data fetched:', data))
    .catch(error => console.error('Fetch error:', error));

export default axiosClient;