const express = require("express");
const app = express();
const PORT = process.env.PORT || 4000;
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

    response = formatCourseData(response);

    res.json(response);
  } catch (error) {
    console.error("API Error:", error.response?.data || error.message);
    res.status(500).send("Failed to fetch courses");
  }
});
app.get("/lp", async (req, res) => {
  try {
    //   const token = await getToken();
    //   const token = "get from the Docebo API management webpage for hard-coded testing";
    //   const response = await axios.get(
    //     "https://solacelearn.docebosaas.com/learningplan/v1/learningplans?courses_filter=with_assigned_courses&status_filter[]=1&page_size=100&page=1",
    //     {
    //       headers: {
    //         Authorization: `Bearer ${token}`,
    //       },
    //     }
    //   );

    //   const formattedData = await formatLearningPlanData(response);

    //   res.json(formattedData);
    let placeholder = [];
    res.json(placeholder);
  } catch (error) {
    console.error("API Error:", error.response?.data || error.message);
    res.status(500).send("Failed to fetch courses");
  }
});

// Utility Functions
const formatCourseData = (response) => {
  let data = response.data.data.items;
  return data.map((course) => ({
    id: course.id_course,
    name: course.name,
    updated_at: formatDate(course.date_last_updated),
    description: course.description,
    price:
      course.price > 0 ? `$${parseFloat(course.price).toFixed(2)}` : "Free",
    img_url: course.img_url,
    course_type: course.course_type,
    duration: course.duration,
    current_rating: course.current_rating,
    category: course.category,
  }));
};
const formatLearningPlanData = (response) => {
  let data = response.data.data.items;
  return data.map((lp) => ({
    id: lp.learning_plan_id,
    name: lp.title,
    updated_at: formatDate(lp.updated_on),
    description: lp.description,
    img_url: lp.thumbnail_url,
    course_type: "learning-plan",
    price:
      lp.price > 0 ? `$${(parseFloat(lp.price) / 100).toFixed(2)}` : "Free",
    assigned_courses_count: lp.assigned_courses_count,
  }));
};
const formatDate = (dateString) => {
  const options = { year: "numeric", month: "short", day: "numeric" };
  return new Date(dateString).toLocaleDateString("en-US", options);
};

// Start server with initial token
app.listen(PORT, async () => {
  tokenData = await getNewToken();
  console.log(`Server running on port: ${PORT}`);
});
