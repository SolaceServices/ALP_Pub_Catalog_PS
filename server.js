const express = require("express");
const app = express();
const axios = require("axios");
const cors = require("cors");
const CircuitBreaker = require("opossum");
const PORT = process.env.PORT || 4000;
require("dotenv").config();
const breaker = new CircuitBreaker(axios.get, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  rollingCountTimeout: 60000,
  rollingCountBuckets: 10,
  name: "API-Circuit-Breaker",
});

app.use(express.json());
app.use(cors());

// Token Management
let tokenData = {
  access_token: "",
  refresh_token: "",
  expires_at: 0,
  isRefreshing: false,
};
const tokenMetrics = {
  refreshAttempts: 0,
  refreshFailures: 0,
  lastSuccess: null,
  lastFailure: null,
};
const generateInitialToken = async () => {
  try {
    const response = await axios.post(
      "https://training.solace.com/oauth2/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "password",
        username: process.env.API_USERNAME,
        password: process.env.API_PASSWORD,
        scope: "api",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    tokenData = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_at: Date.now() + response.data.expires_in * 1000,
      isRefreshing: false,
    };

    tokenMetrics.lastSuccess = new Date();
    return tokenData;
  } catch (error) {
    tokenMetrics.lastFailure = new Date();
    console.error("Initial token generation failed:", error.message);
    throw error;
  }
};
const refreshToken = async () => {
  if (tokenData.isRefreshing) {
    throw new Error("Refresh already in progress");
  }

  tokenData.isRefreshing = true;
  tokenMetrics.refreshAttempts++;

  try {
    const response = await axios.post(
      "https://training.solace.com/oauth2/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: tokenData.refresh_token,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    tokenData = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || tokenData.refresh_token,
      expires_at: Date.now() + response.data.expires_in * 1000,
      isRefreshing: false,
    };

    tokenMetrics.lastSuccess = new Date();
    return tokenData;
  } catch (error) {
    tokenMetrics.refreshFailures++;
    tokenMetrics.lastFailure = new Date();
    tokenData.isRefreshing = false;
    console.error("Refresh token failed:", error.message);
    throw error;
  }
};
async function getToken() {
  if (!tokenData.refresh_token) {
    return generateInitialToken();
  }

  if (Date.now() >= tokenData.expires_at - 300000) {
    try {
      return await refreshToken();
    } catch (error) {
      console.log("Refresh failed, generating new token...");
      return generateInitialToken();
    }
  }

  return tokenData;
}

// Error Handling Middleware
app.use((err, req, res, next) => {
  if (err.code === "ECIRCUITBREAKER") {
    return res.status(503).json({
      error: "Service temporarily unavailable",
      retryAfter: 30,
    });
  }
  next(err);
});

// Routes
app.get("/", (req, res) => {
  res.send("API is running!");
});

app.get("/courses", async (req, res) => {
  //don't need access token for public courses
  try {
    const response = await breaker.fire(
      "https://solacelearn.docebosaas.com/learn/v1/courses",
      {
        params: {
          visibility: 1,
          page_size: 100,
        },
      }
    );
    res.json(formatCourseData(response.data));
  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({
      error: "Failed to fetch courses",
      details: error.message,
    });
  }
});
app.get("/lp", async (req, res) => {
  try {
    const { access_token } = await getToken();

    const response = await breaker.fire(
      "https://training.solace.com/learningplan/v1/learningplans",
      {
        params: {
          courses_filter: "with_assigned_courses",
          status_filter: ["1"],
          page_size: 100,
          page: 1,
        },
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );
    res.json(formatLearningPlanData(response.data));
  } catch (error) {
    console.error("LP Route Error:", error.message);

    if (error.code === "ECIRCUITBREAKER") {
      return res.status(503).json({
        error: "Service temporarily unavailable",
        retryAfter: 30,
      });
    }

    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});
app.get("/health", (req, res) => {
  try {
    const status = tokenData.access_token ? "healthy" : "degraded";
    res.json({
      status,
      tokenMetrics,
      circuitBreaker: {
        state: breaker.status.stats.opened ? "open" : "closed",
        stats: breaker.stats,
      },
    });
  } catch (error) {
    console.error("Health Route Error:", error.message);
    res.status(500).json({
      error: "Failed Health Check",
      details: error.message,
    });
  }
});

// Data Formatting
const formatCourseData = (response) => {
  const data = response.data?.items || [];
  return data.map((course) => ({
    id: course.id_course,
    name: course.name,
    updated_at: formatDate(course.date_last_updated),
    description: course.description,
    price:
      course.price > 0 ? `$${parseFloat(course.price).toFixed(2)}` : "Free",
    img_url: course.img_url || null,
    course_type: course.course_type,
    duration: course.duration,
    current_rating: course.current_rating || 0,
    category: course.category || "Uncategorized",
  }));
};
const formatLearningPlanData = (response) => {
  const data = response.data?.items || [];
  return data.map((lp) => ({
    id: lp.learning_plan_id,
    name: lp.title,
    updated_at: formatDate(lp.updated_on),
    description: lp.description,
    img_url: lp.thumbnail_url || null,
    course_type: "learning-plan",
    price:
      lp.price > 0 ? `$${(parseFloat(lp.price) / 100).toFixed(2)}` : "Free",
    assigned_courses_count: lp.assigned_courses_count || 0,
  }));
};
const formatDate = (dateString) => {
  try {
    const options = { year: "numeric", month: "short", day: "numeric" };
    return new Date(dateString).toLocaleDateString("en-US", options);
  } catch (e) {
    return "Invalid date format";
  }
};

// Graceful Shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
const server = app.listen(PORT, async () => {
  console.log("Server starting...");
  try {
    tokenData = await generateInitialToken();
    console.log(`Server running on port: ${PORT}`);
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
});
