const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();
let tokenData = {
  access_token: "null",
  expires_at: 0,
};

app.use(express.json());
app.use(cors());

// Token management functions
async function getNewToken() {
  const response = await axios.post(
    "https://solacelearn.docebosaas.com/oauth2/token",
    `grant_type=client_credentials&scope=api`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return {
    access_token: response.data.access_token,
    expires_at: Date.now() + response.data.expires_in * 1000,
  };
}
async function getToken() {
  if (Date.now() >= tokenData.expires_at - 300000) {
    // Refresh 5 mins early
    tokenData = await getNewToken();
  }
  return tokenData.access_token;
}

// Axios global error handling
axios.interceptors.response.use(null, async (error) => {
  if (error.response.status === 401) {
    const newToken = await getNewToken();
    error.config.headers.Authorization = `Bearer ${newToken}`;
    return axios(error.config);
  }
  return Promise.reject(error);
});

// Routes
app.get("/courses", async (req, res) => {
  try {
    const token = await getToken();
    let response = await axios.get(
      "https://solacelearn.docebosaas.com/learn/v1/courses",
      {
        params: {
          visibility: 1,
          page_size: 100,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    response = formatData(response);

    res.json(response);
  } catch (error) {
    console.error("API Error:", error.response?.data || error.message);
    res.status(500).send("Failed to fetch courses");
  }
});

// Start server with initial token
app.listen(PORT, async () => {
  tokenData = await getNewToken();
  console.log(`Server running on port: ${PORT}`);
});

// Utility Functions
const formatData = (response) => {
  let data = response.data.data.items;
  return data.map((course) => ({
    id: course.id_course,
    name: course.name.toUpperCase(),
    updated_at: formatDate(course.date_last_updated),
    description: course.description,
    price: course.price > 0 ? `$${(course.price / 100).toFixed(2)}` : "Free",
    img_url: course.img_url,
    course_type: course.course_type,
    duration: course.duration,
    current_rating: course.current_rating,
    category: course.category,
  }));
};

// Date formatting helper
const formatDate = (dateString) => {
  const options = { year: "numeric", month: "short", day: "numeric" };
  return new Date(dateString).toLocaleDateString("en-US", options);
};
